# AGENTS.md

## Project Overview

Ebook reader web app. Users drag-and-drop `.epub` files, which are persisted in IndexedDB. Inbox-style layout with a book list sidebar and reader pane.

## Tech Stack

- **Framework**: React Router v7 (framework mode) with TypeScript
- **Styling**: Tailwind CSS v4 + shadcn/ui (Base UI, not Radix)
- **Epub Rendering**: epubjs
- **Storage**: idb-keyval (IndexedDB) — use separate databases for separate stores (idb-keyval limitation: one object store per database). IndexedDB stores must be lazy-initialized via getter functions, not created at module scope. Module-scope `createStore()` calls will fail during SSR. Pattern:
  ```ts
  let _store: ReturnType<typeof createStore> | null = null;
  function getStore() {
    if (!_store) _store = createStore("db-name", "store-name");
    return _store;
  }
  ```
- **Fonts**: Google Fonts + self-hosted Geist/Geist Mono (woff2 variable fonts in `public/fonts/`)
- **Linting**: oxlint (no eslint)
- **Formatting**: oxfmt
- **Effect System**: Effect.ts (`effect` package)
- **Database**: Postgres via `pg` + `pg-sql` (PlanetScale Postgres on Vercel with Fluid Compute)
- **Auth**: Self-hosted WebAuthn passkeys via `@simplewebauthn/server` + `@simplewebauthn/browser`
- **File Storage**: Vercel Blob (private access, server-proxied)
- **Sync**: Local-first sync engine with per-entity-type merge strategies (LWW, set-union, append-only)
- **Package Manager**: pnpm

## Key Architecture Decisions

### Epub iframe isolation

epubjs renders content inside an iframe. The iframe is a separate document that does NOT inherit:

- Parent page CSS (including Tailwind dark mode classes)
- Parent page font imports (Google Fonts `<link>` tags)

To style epub content, inject directly into the iframe via `rendition.hooks.content.register()`:

- Inject `<link>` tags for Google Fonts
- Inject `<style>` tags with `@font-face` declarations for self-hosted fonts
- Inject `<style>` tags with typography CSS (`font-family`, `font-size`, `line-height`) using `!important`
- Use `rendition.themes.register()` / `rendition.themes.select()` for dark/light color theming

Do NOT use `rendition.themes.override()` for typography — it is unreliable and gets reset by `themes.select()`.

### Settings persistence

All reader settings (theme, layout mode, font, size, line height) are stored in localStorage via a shared `useSettings()` hook in `app/lib/settings.ts`.

Reading positions (CFI strings) are stored per-book in IndexedDB using a separate database from the book data.

### Client-side only

All epub parsing, IndexedDB access, and rendering must happen client-side. Use `clientLoader` (not `loader`) in React Router routes. epubjs and IndexedDB APIs are not available during SSR.

### Sync architecture

The app is local-first: IndexedDB is the source of truth. Sync is optional and requires authentication.

**Change tracking**: All service mutations (BookService, AnnotationService, ChatService, Settings) call `recordChange()` which writes to a changelog IDB store. Changes are queued and pushed to the server on an interval or immediately on `sync:push-needed` events.

**Merge strategies**:

- Books, reading positions, notebooks, settings: Last-Write-Wins (LWW) by `updatedAt`
- Highlights: Set-union with tombstone propagation (soft delete)
- Chat messages: Append-only (ON CONFLICT DO NOTHING)

**Sync events**: The sync engine dispatches granular `sync:entity-updated` events (not a blanket event). Components use the `useSyncListener(["entity"])` hook to only re-render when their specific data changes.

**File sync**: Epub files and covers are uploaded to Vercel Blob (private). On pull, metadata syncs immediately; files are downloaded on-demand when the user opens the book.

**Initial sync**: On first login, `runInitialSyncIfNeeded()` scans all IDB stores and backfills the change log so existing data gets pushed.

### Effect.ts conventions

The project uses Effect.ts for service-based dependency injection and typed error handling. Follow the established patterns:

**Services** -- define with `Context.Tag`, implement with `Layer.succeed`:

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

**Errors** -- define with `Data.TaggedError` in `app/lib/errors.ts`. Always include an `operation` field and optional `cause`:

```ts
import { Data } from "effect";

export class MyError extends Data.TaggedError("MyError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}
```

**Runtime** -- all service layers are composed in `app/lib/effect-runtime.ts` via `Layer.mergeAll` and exposed as `AppRuntime` (a `ManagedRuntime`). When adding a new service, add its live layer to `AppLayer` in that file.

**Executing effects** -- at call sites (route loaders, event handlers, React hooks), run effects through `AppRuntime.runPromise(...)`. Two common access patterns:

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

**Error handling** -- handle errors in the Effect pipeline, not after `runPromise`:

- Use `Effect.catchAll` or `Effect.catchTag` _before_ `runPromise` to handle errors within the Effect pipeline, not `try/catch` after:
  ```ts
  Effect.catchTag("BookNotFoundError", () =>
    Effect.die(new Response("Book not found", { status: 404 })),
  );
  ```
- Fire-and-forget `runPromise` calls (e.g. debounced saves) must always have `.catch()`:
  ```ts
  AppRuntime.runPromise(effect).catch(console.error);
  ```
- Use `Effect.ensuring` for cleanup logic instead of `finally`
- Do **not** use raw `try/catch` around IndexedDB or other async service calls. Wrap them in `Effect.tryPromise` and let Effect propagate typed errors.

## Coding Conventions

- Use pnpm for all package management
- Use conventional commits (e.g., `feat:`, `fix:`)
- No emoji in commit messages
- Prefer `cn()` with object syntax for conditional Tailwind classes instead of inline template literals
- shadcn components use Base UI (not Radix) — check component APIs accordingly (e.g., `DropdownMenuLabel` must be inside `DropdownMenuGroup`)
- When adding shadcn components: `pnpx shadcn@latest add <component>`
- Prefer self-hosted fonts over CDN when font files are available locally
- Always run `pnpm oxfmt .` before committing to ensure consistent formatting
- Always run `pnpm oxlint` before committing and fix any warnings
- Wrap custom event dispatches in `queueMicrotask()` to avoid React flushSync errors
- Use `useSyncListener(["entity"])` hook for sync reactivity, not raw event listeners

## Component Architecture Rules

### File size limits

- No single component file should exceed ~500 lines. If it does, extract hooks or decompose into sub-components.
- Prefer extracting reusable hooks into `app/hooks/` when the same logic appears in multiple components.

### No barrel modules

- Do NOT create `index.ts` or re-export files. Import directly from the source module.
- Bad: `import { Foo } from "~/components/foo"` (resolves to foo/index.ts)
- Good: `import { Foo } from "~/components/foo/foo-component"`

### No prop drilling

- When a component needs data from a React context, consume the context directly via its hook (e.g., `useWorkspace()`). Do NOT create adapter/wrapper components that destructure context and pass values as props.
- Exception: components that need to work in multiple contexts (e.g., `BookReader` works both standalone and in workspace) should accept props for the context-dependent parts.

### Shared hooks

- `app/hooks/use-epub-lifecycle.ts` — shared epub initialization and lifecycle (used by both reader components)
- `app/hooks/use-reader-search.ts` — shared search state, annotations, keyboard shortcuts
- `app/hooks/use-toolbar-auto-hide.ts` — mobile toolbar auto-hide timer
- When adding epub reader functionality, add it to the shared hook rather than duplicating in individual readers.

### Component decomposition

- `app/components/chat/` — chat panel split into focused modules (chat-panel, chat-message, chat-empty-state, se-book-cards, chat-utils, use-chat-tool-handlers)
- Follow this pattern for other large components: create a subdirectory with focused modules, no barrel index file.

### E2E tests

- Playwright E2E tests live in `e2e/` and run via `pnpm e2e`
- Always run `pnpm e2e` after structural refactors to verify nothing broke
- Test fixture epub is in `e2e/fixtures/test-book.epub`
