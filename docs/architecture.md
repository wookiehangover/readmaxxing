# Architecture

Ebook reader web app. Users drag-and-drop `.epub` files, persisted in IndexedDB. Inbox-style layout with a book list sidebar and reader pane. The app is local-first for most entities (IndexedDB is the source of truth, sync is optional and requires auth). **Chat is the exception** — Postgres is authoritative.

## Client-side only

All epub parsing, IndexedDB access, and rendering must happen client-side. Use `clientLoader` (not `loader`) in React Router routes. epubjs and IndexedDB APIs are not available during SSR.

## Storage

- `idb-keyval` (IndexedDB): use **separate databases for separate stores** (idb-keyval allows one object store per database).
- IndexedDB stores must be lazy-initialized via getter functions, not at module scope. Module-scope `createStore()` calls fail during SSR:
  ```ts
  let _store: ReturnType<typeof createStore> | null = null;
  function getStore() {
    if (!_store) _store = createStore("db-name", "store-name");
    return _store;
  }
  ```

## Epub iframe isolation

epubjs renders content inside an iframe — a separate document that does NOT inherit parent-page CSS (including Tailwind dark mode) or font imports.

To style epub content, inject directly into the iframe via `rendition.hooks.content.register()`:

- Inject `<link>` tags for Google Fonts.
- Inject `<style>` tags with `@font-face` for self-hosted fonts.
- Inject `<style>` tags with typography CSS (`font-family`, `font-size`, `line-height`) using `!important`.
- Use `rendition.themes.register()` / `rendition.themes.select()` for dark/light color theming.
- Do NOT use `rendition.themes.override()` for typography — it is unreliable and gets reset by `themes.select()`.

## Settings & reading positions

- Reader settings (theme, layout mode, font, size, line height) live in localStorage via `useSettings()` in `app/lib/settings.ts`.
- Reading positions (CFI strings) are stored per-book in IndexedDB in a separate database from book data.

## Sync

- **Change tracking**: Service mutations (BookService, AnnotationService, Settings, chat session metadata) call `recordChange()` which writes to a changelog IDB store. Changes are queued and pushed on an interval or immediately on `sync:push-needed`. Chat message bodies are **not** recorded — the server persists them directly when streaming `/api/chat`.
- **Merge strategies**:
  - Books, reading positions, notebooks, settings, chat session metadata: Last-Write-Wins by `updatedAt`.
  - Highlights: set-union with tombstone propagation (soft delete).
  - Chat messages: append-only (`ON CONFLICT DO NOTHING`) — written server-side during streaming; sync pull only hydrates the IDB warm-start cache.
- **Sync events**: the engine dispatches granular `sync:entity-updated` events. Components use `useSyncListener(["entity"])` to re-render only on their data.
- **File sync**: epub files and covers upload to Vercel Blob (private). On pull, metadata syncs immediately; files download on-demand when the book is opened.
- **Initial sync**: on first login, `runInitialSyncIfNeeded()` scans all IDB stores and backfills the change log so existing data gets pushed.

## Chat

Chat is **server-authoritative**: Postgres (`readmax.chat_session`, `readmax.chat_message`) is the source of truth, not IndexedDB — a deliberate deviation from local-first because chat streams LLM output and runs server tools.

- **Transport**: client uses the AI SDK `DefaultChatTransport` with `resume: true`. On mount, `useChat` hydrates history from `/api/chat/messages/:sessionId` and, if an `activeStreamId` is present, reconnects to the in-flight SSE stream via `/api/chat/resume/:sessionId` (backed by `resumable-stream` + Redis). Survives reloads and tab switches mid-generation.
- **IDB as warm-start cache**: `app/lib/stores/chat-store.ts` keeps a per-session IDB copy of messages so the panel can paint before server hydration returns. Written from the server list via `cacheServerMessages()`; **never** pushed to the server for messages. Session metadata (title, `bookId`, timestamps) syncs LWW as `chat_session`.
- **Server-executed tools** (run inside the `/api/chat` handler, not the browser): `read_notes`, `append_to_notes`, `edit_notes` (sandboxed JS edit script against the notebook SDK), `create_highlight` (upserts by text anchor; CFI resolved later by client). Output streams back as SSE UI message parts. `app/components/chat/use-chat-tool-handlers.ts` watches for `output-available` parts and applies the state change locally; the client does **not** re-run these tools.
- **Auth-gated endpoints** (all require a valid passkey session; unauthenticated → 401, panel shows sign-in CTA):
  - `POST /api/chat` — start or continue a chat turn
  - `POST /api/chat-title` — generate a session title
  - `GET /api/chat/resume/:sessionId` — resume an in-flight stream
  - `GET /api/chat/messages/:sessionId` — hydrate message history

## Shared reader hooks

- `app/hooks/use-epub-lifecycle.ts` — shared epub init and lifecycle (both reader components).
- `app/hooks/use-reader-search.ts` — shared search state, annotations, keyboard shortcuts.
- `app/hooks/use-toolbar-auto-hide.ts` — mobile toolbar auto-hide timer.
- Add new epub reader functionality to the shared hook rather than duplicating per reader.
