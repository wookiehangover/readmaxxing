# AGENTS.md

## Project overview

Ebook reader web app. Users drag-and-drop `.epub` files, which are persisted in IndexedDB. Inbox-style layout with a book list sidebar and reader pane.

## Tech stack

- **Framework**: React Router v7 (framework mode) with TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui (Base UI, not Radix)
- **Epub rendering**: epubjs
- **Local storage**: idb-keyval (IndexedDB). One object store per database — see "IndexedDB store pattern" below
- **Fonts**: Google Fonts + self-hosted Geist / Geist Mono (woff2 variable fonts in `public/fonts/`)
- **Linting**: oxlint (no eslint)
- **Formatting**: oxfmt (no prettier)
- **Effect system**: Effect.ts (`effect` package)
- **Runtime**: Cloudflare Workers via `@cloudflare/vite-plugin` + `@react-router/cloudflare`
- **Database**: Postgres via `pg` + `pg-sql`. In production the Worker connects directly over `cloudflare:sockets` using the `DATABASE_URL` secret; locally it points at a normal `DATABASE_URL`
- **File storage**: Cloudflare R2, private buckets, server-proxied
- **Chat runtime**: Cloudflare Agents SDK on top of Durable Objects
- **Auth**: self-hosted WebAuthn passkeys via `@simplewebauthn/server` + `@simplewebauthn/browser`
- **Sync**: local-first sync engine with per-entity merge strategies (LWW, set-union, append-only)
- **Package manager**: pnpm

### IndexedDB store pattern

idb-keyval allows only one object store per database, so each logical store gets its own database. Stores must be lazy-initialized via a getter — module-scope `createStore()` calls run during SSR and crash:

```ts
let _store: ReturnType<typeof createStore> | null = null;
function getStore() {
  if (!_store) _store = createStore("db-name", "store-name");
  return _store;
}
```

## Architecture decisions

### Epub iframe isolation

epubjs renders content inside an iframe. The iframe is a separate document that does not inherit:

- Parent page CSS (including Tailwind dark mode classes)
- Parent page font imports (Google Fonts `<link>` tags)

To style epub content, inject directly into the iframe via `rendition.hooks.content.register()`:

- Inject `<link>` tags for Google Fonts
- Inject `<style>` tags with `@font-face` declarations for self-hosted fonts
- Inject `<style>` tags with typography CSS (`font-family`, `font-size`, `line-height`) using `!important`
- Use `rendition.themes.register()` / `rendition.themes.select()` for dark/light color theming

**Do not** use `rendition.themes.override()` for typography — it is unreliable and gets reset by `themes.select()`.

### Settings persistence

Reader settings (theme, layout mode, font, size, line height) live in `localStorage` behind the shared `useSettings()` hook in `app/lib/settings.ts`.

Reading positions (CFI strings) live in IndexedDB, in a separate database from the book data, keyed per book.

### Client-side only

All epub parsing, IndexedDB access, and rendering must happen client-side. Use `clientLoader` (not `loader`) in React Router routes; epubjs and IndexedDB are unavailable during SSR.

### Sync architecture

The app is local-first for most entities: IndexedDB is the source of truth and sync is opt-in (it requires authentication). Chat is the exception — Postgres is authoritative for chat sessions and messages; see "Chat architecture" below.

**Change tracking.** Service mutations (`BookService`, `AnnotationService`, `Settings`, chat session metadata) call `recordChange()` in `app/lib/sync/change-log.ts`, which appends to a changelog IDB store. Changes are flushed on a periodic interval and immediately on `sync:push-needed` events. Chat message bodies are not recorded here — the server persists them while streaming `/api/chat`.

**Merge strategies (per entity).**

- Books, reading positions, notebooks, settings, chat session metadata: Last-Write-Wins by `updatedAt`
- Highlights: set-union with tombstone propagation (soft delete)
- Chat messages: append-only (`ON CONFLICT DO NOTHING`); written server-side during streaming. A pull only hydrates the IDB warm-start cache — see "Chat architecture"

**Sync events.** The sync engine dispatches granular `sync:entity-updated` events with the affected entity in `event.detail.entity`, not a blanket "something changed" event. Components subscribe via the `useSyncListener(["entity"])` hook so they only re-render when their data changes.

**File sync.** Epub files and covers live in private R2 buckets (`R2_FILES`, `R2_COVERS`). A pull syncs metadata immediately; the file bytes are downloaded on demand through the authenticated `/api/sync/files/download` proxy when the user opens the book. Uploads go through `/api/sync/files/upload`.

**Initial sync.** On first login, `runInitialSyncIfNeeded()` walks every IDB store and backfills the change log so pre-existing local data gets pushed.

### Chat architecture

Chat is **server-authoritative**: the Postgres tables `readmax.chat_session` and `readmax.chat_message` are the source of truth for sessions and messages, not IndexedDB. This is a deliberate departure from the local-first model used everywhere else, because chat involves streaming LLM output and server-executed tools.

**Transport.** The client uses the AI SDK's `DefaultChatTransport` with `resume: true`. Each chat session is owned by one Cloudflare Agent (Durable Object) keyed by session id (binding name `AGENTS`, class `ChatAgent`). On mount, the chat panel hydrates message history from `GET /api/chat/messages/:sessionId`, and if the session has an `activeStreamId` it reconnects to the in-flight SSE via `GET /api/chat/resume/:sessionId`. Resumability is provided entirely by the Durable Object holding stream state — there is no Redis and no `resumable-stream` runtime.

**IDB warm-start cache.** `app/lib/stores/chat-store.ts` keeps a per-session IDB copy of messages so the panel can paint something before the server hydration request returns. It is written from the server-authoritative list via `cacheServerMessages()` and is **never** pushed to the server. Session metadata (title, `bookId`, timestamps, `activeStreamId`) is still synced LWW through the regular sync engine as the `chat_session` entity.

**Server-executed tools.** These tools run inside `ChatAgent` on the server, not in the browser:

- `read_notes` — reads the user's notebook from Postgres and returns its markdown
- `append_to_notes` — appends markdown to the notebook and persists it server-side
- `edit_notes` — runs a sandboxed JS edit script against the notebook SDK and persists the result
- `create_highlight` — upserts a highlight row keyed by a text anchor (chapter index + snippet); the CFI is resolved later by the client

Tool output is streamed back as SSE UI message parts. `app/components/chat/use-chat-tool-handlers.ts` watches for `output-available` parts and applies the resulting state change locally (update the notebook editor, add the highlight to the annotations store, resolve the CFI). The client **never** re-runs these tools.

**Auth-gated endpoints.** All chat endpoints require a valid passkey session and return 401 otherwise. When signed out the chat panel renders a sign-in CTA instead of an input — it does not attempt to stream locally.

- `POST /api/chat` — start or continue a chat turn
- `POST /api/chat-title` — generate a session title
- `GET /api/chat/resume/:sessionId` — resume an in-flight stream
- `GET /api/chat/messages/:sessionId` — hydrate message history

### Effect.ts conventions

The project uses Effect.ts for service-based dependency injection and typed error handling. Follow the established patterns.

**Services** — define with `Context.Tag`, implement with `Layer.succeed`:

```ts
import { Context, Effect, Layer } from "effect";

export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doThing: (arg: string) => Effect.Effect<Result, MyError>;
  }
>() {}

export const MyServiceLive = Layer.succeed(MyService, {
  doThing: (arg) =>
    Effect.tryPromise({
      try: () => someAsyncWork(arg),
      catch: (cause) => new MyError({ operation: "doThing", cause }),
    }),
});
```

**Errors** — define with `Data.TaggedError` in `app/lib/errors.ts`. Always include an `operation` field and an optional `cause`:

```ts
import { Data } from "effect";

export class MyError extends Data.TaggedError("MyError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}
```

**Runtime** — all service layers are composed in `app/lib/effect-runtime.ts` via `Layer.mergeAll` and exposed as `AppRuntime` (a `ManagedRuntime`). When adding a new service, add its live layer to `AppLayer` in that file.

**Executing effects** — at call sites (route loaders, event handlers, React hooks), run effects through `AppRuntime.runPromise(...)`. Two common access patterns:

1. Pipe from the service tag (shorter, good for one-shot calls):

   ```ts
   await AppRuntime.runPromise(BookService.pipe(Effect.andThen((s) => s.getBooks())));
   ```

2. Generator style (better when chaining multiple service calls):

   ```ts
   const program = Effect.gen(function* () {
     const svc = yield* AnnotationService;
     return yield* svc.getHighlightsByBook(bookId);
   });
   await AppRuntime.runPromise(program);
   ```

3. `useEffectQuery` hook (preferred for declarative data loading in React components):

   ```ts
   const { data, error, isLoading } = useEffectQuery(
     () => BookService.pipe(Effect.andThen((s) => s.getBooks())),
     [deps],
   );
   ```

   Reserve `AppRuntime.runPromise` for route loaders, event handlers, and fire-and-forget operations. Use `useEffectQuery` for component-level data loading.

**Error handling** — handle errors inside the Effect pipeline, not after `runPromise`:

- Use `Effect.catchAll` or `Effect.catchTag` _before_ `runPromise`, not `try/catch` after it:

  ```ts
  Effect.catchTag("BookNotFoundError", () =>
    Effect.die(new Response("Book not found", { status: 404 })),
  );
  ```

- Fire-and-forget `runPromise` calls (e.g. debounced saves) must always have `.catch()`:

  ```ts
  AppRuntime.runPromise(effect).catch(console.error);
  ```

- Use `Effect.ensuring` for cleanup logic instead of `finally`.
- **Do not** wrap IndexedDB or other async service calls in raw `try/catch`. Wrap them in `Effect.tryPromise` and let Effect propagate typed errors.

## Coding conventions

- Use pnpm for all package management
- Use conventional commits (e.g. `feat:`, `fix:`)
- No emoji in commit messages
- Prefer `cn()` with object syntax for conditional Tailwind classes instead of inline template literals
- shadcn components use Base UI (not Radix) — check component APIs accordingly (e.g. `DropdownMenuLabel` must be inside `DropdownMenuGroup`)
- When adding shadcn components: `pnpx shadcn@latest add <component>`
- Prefer self-hosted fonts over CDN when font files are available locally
- Always run `pnpm oxfmt .` before committing to ensure consistent formatting
- Always run `pnpm oxlint` before committing and fix any warnings
- Wrap custom event dispatches in `queueMicrotask()` to avoid React `flushSync` errors
- Use the `useSyncListener(["entity"])` hook for sync reactivity, not raw event listeners

## Component architecture rules

### File size limits

- No single component file should exceed ~500 lines. If it does, extract hooks or decompose into sub-components.
- Prefer extracting reusable hooks into `app/hooks/` when the same logic appears in multiple components.

### No barrel modules

- **Do not** create `index.ts` or re-export files. Import directly from the source module.
- Bad: `import { Foo } from "~/components/foo"` (resolves to `foo/index.ts`)
- Good: `import { Foo } from "~/components/foo/foo-component"`

### No prop drilling

- When a component needs data from a React context, consume the context directly via its hook (e.g. `useWorkspace()`). Do not create adapter / wrapper components that destructure context and pass values as props.
- Exception: components that need to work in multiple contexts (e.g. `BookReader` works both standalone and inside a workspace) should accept props for the context-dependent parts.

### Shared hooks

- `app/hooks/use-epub-lifecycle.ts` — shared epub initialization and lifecycle (used by both reader components)
- `app/hooks/use-reader-search.ts` — shared search state, annotations, keyboard shortcuts
- `app/hooks/use-toolbar-auto-hide.ts` — mobile toolbar auto-hide timer

When adding epub reader functionality, add it to the shared hook rather than duplicating in individual readers.

### Component decomposition

- `app/components/chat/` — chat panel split into focused modules (`chat-panel`, `chat-message`, `chat-empty-state`, `se-book-cards`, `chat-utils`, `use-chat-tool-handlers`)
- Follow this pattern for other large components: a subdirectory with focused modules, no barrel index file.

## Testing

- Playwright E2E tests live in `e2e/` and run via `pnpm e2e`
- The test fixture epub is `e2e/fixtures/test-book.epub`
- Always run `pnpm e2e` after structural refactors to verify nothing broke
