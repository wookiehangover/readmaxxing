# Architecture

Ebook/PDF reader web app. Users add `.epub`/`.pdf` files (drag-and-drop, file picker, or the Standard Ebooks catalog), persisted in IndexedDB. The app is local-first for most entities (IndexedDB is the source of truth; sync is optional and requires a passkey session). **Chat is the exception** — Postgres is authoritative.

## Workspace layout

The main route (`app/routes/workspace.tsx`) is a [dockview](https://dockview.dev) multi-panel workspace, not a fixed sidebar/reader split.

- **Panel types** (`app/components/workspace/`): book reader, chat, notebook, bookmarks, reading history, new-tab, Standard Ebooks browser, watermark (empty state).
- **Book clusters**: a reader panel plus its chat/notebook tabs form a logical "cluster" (`BookCluster` in `app/lib/context/workspace-context.tsx`) so link navigation can resolve which chat/notebook belongs to which book.
- **Layout modes** (`layoutMode` in settings): `focused` (one cluster visible, book/right-group split by `focusedSplitRatio`) and `freeform` (all panels mounted). Switching modes mounts/unmounts panels.
- Workspace state lives in `app/lib/stores/workspace-store.ts`; layout/panel logic in `app/hooks/use-workspace-*.ts`.

## Client-side only

All epub/pdf parsing, IndexedDB access, and rendering must happen client-side. Routes use `clientLoader` (with `clientLoader.hydrate = true`), never `loader`. epubjs, pdfjs, and IndexedDB are unavailable during SSR.

## Storage

- `idb-keyval` (IndexedDB). idb-keyval allows one object store per database, so **each entity uses a separate database**.
- All store accessors live in `app/lib/sync/stores.ts` and are **lazy getter functions** (`getBookStore()`, `getPositionStore()`, …), not module-scope `createStore()` calls — module-scope creation fails during SSR (`indexedDB` undefined in Node). Add new stores there.
- Book metadata and book binary data (epub/pdf `ArrayBuffer`) live in separate databases.

## Epub iframe isolation

epubjs renders content inside an iframe — a separate document that does NOT inherit parent-page CSS (including Tailwind dark mode) or font imports. Style it by injecting into the iframe via `rendition.hooks.content.register()` / `spine.hooks.content.register()` (see `app/hooks/use-epub-lifecycle.ts`, `app/lib/epub/epub-rendering-utils.ts`):

- Inject `<link>` tags for Google Fonts and `<style>` `@font-face` for self-hosted fonts.
- Inject `<style>` with typography CSS (`font-family`, `font-size`, `line-height`) using `!important`.
- Use `rendition.themes.register()` / `themes.select()` for dark/light color theming.
- Do NOT use `themes.override()` for typography — unreliable and reset by `themes.select()`.

PDFs render via pdfjs (`app/lib/pdf/`, `app/components/workspace-pdf-reader.tsx`) and do not have this constraint.

## Settings & reading positions

- Reader settings (theme, layout mode, fonts, sizes, split ratio) live in localStorage via `useSettings()` / `getSettings()` in `app/lib/settings.ts`.
- Reading positions are stored per-book in IndexedDB as `{ cfi, updatedAt }` LWW records (`app/lib/stores/position-store.ts`); epub uses a CFI string, pdf a `page:N` pseudo-CFI.

## Sync

Engine: `app/lib/sync/sync-engine.ts`. Synced entity types (`app/lib/sync/types.ts`): `book`, `highlight`, `bookmark`, `notebook`, `chat_session`, `chat_message`, `position`, `settings`. (Reading history is local-only.)

- **Change tracking**: service mutations call `recordChange()` (`app/lib/sync/change-log.ts`) which appends to a changelog IDB store. Changes are batched and pushed on an interval or immediately on `sync:push-needed`. Chat message **bodies are not recorded** — the server persists them while streaming `/api/chat`.
- **Merge strategies** (`ENTITY_MERGE_STRATEGIES` in `types.ts`, mergers in `app/lib/sync/entity-mergers.ts`):
  - `lww` (Last-Write-Wins by `updatedAt`): `book`, `position`, `notebook`, `settings`, `chat_session` metadata.
  - `set_union` (with tombstone/soft-delete propagation): `highlight`, `bookmark`.
  - `append_only` (`ON CONFLICT DO NOTHING`): `chat_message` — written server-side during streaming; pull only hydrates the IDB warm-start cache.
- **Sync events**: the engine dispatches granular `sync:entity-updated` events. Components use `useSyncListener(["entity"])` to re-render only on their data.
- **File sync**: epub/pdf files and covers upload to Vercel Blob (private) via `/api/sync/files/*`. Metadata syncs immediately; binaries download on-demand when a book opens. Server may dedupe an uploaded book by `fileHash` and return a `canonicalId`; the client remaps local references (`app/lib/sync/remap.ts`).
- **Initial sync**: on first login `runInitialSyncIfNeeded()` (`initial-sync.ts`) scans all IDB stores and backfills the change log so pre-existing data gets pushed.

## Chat

Chat is **server-authoritative**: Postgres (`readmax.chat_session`, `readmax.chat_message`) is the source of truth, not IndexedDB — a deliberate deviation from local-first because chat streams LLM output and runs server tools. A conversation can span multiple books in a cluster; book-scoped tools take a `bookId` (defaulting to the primary book).

- **Transport**: client uses the AI SDK `DefaultChatTransport` with `resume: true`. On mount, `useChat` hydrates from `/api/chat/messages/:sessionId` and, if an `activeStreamId` is present, reconnects to the in-flight SSE stream via `/api/chat/resume/:sessionId` (`resumable-stream` + Redis). Survives reloads and tab switches mid-generation.
- **IDB warm-start cache**: `app/lib/stores/chat-store.ts` keeps a per-session IDB copy of messages so the panel paints before server hydration. Written from the server list via `cacheServerMessages()`; **never** pushed for messages. Session metadata (title, `bookId`, timestamps) syncs LWW as `chat_session`.
- **Server-executed tools** (run inside `/api/chat`, not the browser): `read_notes`, `append_to_notes`, `edit_notes` (sandboxed JS edit script against the notebook SDK), `create_highlight` (upserts by text anchor; client resolves CFI later), `search_book`, `read_chapter`, `search_standard_ebooks`, plus Anthropic `web_search`. Output streams back as SSE message parts; `app/components/chat/use-chat-tool-handlers.ts` watches for `output-available` parts and applies the state change locally — the client never re-runs these tools.
- **Auth-gated endpoints** (require a passkey session; unauthenticated → 401 with a sign-in CTA): `POST /api/chat`, `POST /api/chat-title`, `GET /api/chat/resume/:sessionId`, `GET /api/chat/messages/:sessionId`.

## Notebooks

Per-book rich-text notes edited with TipTap (`app/components/tiptap-editor.tsx`, `workspace-notebook.tsx`), stored as `JSONContent` in the notebook IDB store and synced LWW as `notebook`. Chat tools (`append_to_notes`, `edit_notes`) write through to IDB and dispatch a sync event; see `NotebookEditorCallbacks.seedLastContent` for the cursor-preservation handshake.

## Sharing

Read-only public share links (`app/routes/share.$id.tsx`, `app/routes/api.share*.ts`, `app/lib/database/share/`). A share exposes a book (epub or pdf), its current position, notebook, and chats via signed, use-count-limited download tokens (`app/lib/share-download-token.ts`). These routes are server-rendered and read from Postgres directly.

## Standard Ebooks

`app/lib/standard-ebooks.ts` + `app/routes/api.standard-ebooks.*.ts` proxy the Standard Ebooks catalog for search, new releases, and download/import into the user's library.

## Auth

WebAuthn passkeys via `@simplewebauthn/*` (`app/routes/api.auth.*.ts`, `app/lib/auth-*.ts`, `app/lib/database/auth/`). Session enforced by `app/lib/database/auth-middleware.ts`; client state in `app/lib/context/auth-context.tsx`.

## Shared reader hooks

Add new reader functionality to the shared hook rather than duplicating per reader:

- Epub: `app/hooks/use-epub-lifecycle.ts`, `use-reader-search.ts`, `use-highlights.ts`.
- PDF: `app/hooks/use-pdf-lifecycle.ts`, `use-pdf-search.ts`, `use-pdf-highlights.ts`, `use-pdf-workspace-panels.ts`.
- Shared: `use-toolbar-auto-hide.ts`, `use-book-search.ts`, `use-book-upload.ts`, `use-book-deletion.ts`.
