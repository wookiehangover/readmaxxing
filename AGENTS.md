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
