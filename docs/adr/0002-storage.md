# ADR 0002: Local storage decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Web storage clearing during reset is best effort

**Context.** localStorage/sessionStorage access throws in private mode or when storage is disabled.

**Decision.** clearWebStorage swallows errors from each clear() call independently.

**Consequences.** Reset continues even if web storage cannot be cleared.

**Code.** `app/components/settings/data-section.tsx#clearWebStorage`

## Blocked IndexedDB deletes are expected during reset, followed by a full reload

**Context.** This tab usually holds idb-keyval connections open, so indexedDB.deleteDatabase fires onblocked. The delete stays queued and normally finishes once connections close; other tabs can still keep data alive.

**Decision.** deleteDatabase resolves "blocked" rather than rejecting. After reset, the app does a full navigation to "/" to drop in-memory state and open IDB connections so queued deletes finish and the user lands signed out. If any delete was blocked, the toast tells the user to close other tabs and reset again.

**Consequences.** Reset never hard-fails on blocked; data held by other tabs may survive until they close.

**Code.** `app/components/settings/data-section.tsx#deleteDatabase`

## Reset local data uses a known IndexedDB name list as a fallback

**Context.** indexedDB.databases() is unavailable in some WebKit/Safari builds and listings can be incomplete, so reset could miss real app data.

**Decision.** KNOWN_INDEXED_DB_NAMES lists every app-owned IndexedDB database. clearIndexedDB unions it with discovered names, or uses it alone when databases() is missing. The list must be kept in sync with createStore(...) call sites under app/lib.

**Consequences.** Adding a new IDB store requires updating this list or reset will leave its data behind.

**Code.** `app/components/settings/data-section.tsx#KNOWN_INDEXED_DB_NAMES`

## Public blob detection uses the public.blob.vercel-storage.com host

**Context.** Public Vercel Blob URLs use <store-id>.public.blob.vercel-storage.com and private ones use <store-id>.blob.vercel-storage.com.

**Decision.** isPublicBlobUrl checks whether the host contains public.blob.vercel-storage.com; such URLs are fetched straight from the CDN, others go through the signed-download proxy.

**Consequences.** Simple and reliable as long as Vercel keeps this host scheme.

**Code.** `app/lib/blob-url.ts#isPublicBlobUrl`

## book_chapters.extractedAt records last persist time, not EPUB parse time

**Context.** Chapter sets can be re-uploaded (legacy single-shot upload and the newer upload flow), so the timestamp stored with the set is rewritten.

**Decision.** extractedAt is the time of the last successful upload/persist of the chapters set. It is not guaranteed to be the original EPUB parse timestamp; upsertBookChapters (legacy single-shot upload) sets it on each successful upload.

**Consequences.** Do not use extractedAt to reason about when parsing happened or which extractor version produced the data.

**Code.** `app/lib/database/book/book-chapters.ts#upsertBookChapters`

## Local review drafts may exceed the grading payload limit

**Context.** Drafts are cached locally while the user edits; the grading request has size limits.

**Decision.** The cache schema validates draft document JSON structure but not the grading payload limit, so oversized drafts stay editable.

**Consequences.** Users are not locked out of their draft; submission enforces limits.

**Code.** `app/lib/review/review-cache.ts`

## Derive current assignments for legacy review caches

**Context.** Older caches predate explicit server membership (currentAssignmentIds).

**Decision.** When missing, currentAssignmentIds is derived from checkpoint references, treated as the last known assignments; the next complete refresh reconciles them.

**Consequences.** Old caches keep working without migration.

**Code.** `app/lib/review/review-cache.ts#loadReviewCache`

## Review cache load awaits pending writes

**Context.** Reopening a book can race the previous scope's final draft write.

**Decision.** loadReviewCache awaits the pending write for the same key (ignoring its error) before reading.

**Consequences.** Reads never miss the latest draft.

**Code.** `app/lib/review/review-cache.ts#loadReviewCache`

## Serialize review cache writes per key

**Context.** Concurrent IDB transactions can complete out of order, letting an older write overwrite a newer draft or persisted retry id.

**Decision.** saveReviewCache chains writes per cache key in a transport-only Map of promises; the Map never owns review data.

**Consequences.** Last write wins in call order; the store remains the single owner of review data.

**Code.** `app/lib/review/review-cache.ts#saveReviewCache`

## Merge book preferences atomically

**Context.** Per-book preferences only store explicit overrides; concurrent edits could clobber each other.

**Decision.** saveBookPreferences uses idb-keyval update() to merge changes into the current record atomically.

**Consequences.** Unrelated settings keep inheriting defaults and overlapping edits do not overwrite each other.

**Code.** `app/lib/stores/book-preferences-store.ts#saveBookPreferences`

## Book listing tolerates malformed IDB records

**Context.** Malformed records (undefined, null, missing fields) in the book store caused 'Cannot read properties of undefined (reading \'0\')' in production.

**Decision.** Book listing skips records that fail decoding instead of throwing, returning the valid books.

**Consequences.** A corrupt record cannot break the library.

**Code.** `app/lib/stores/book-store.ts`, `app/lib/stores/book-store.ts#isBookStoreEntry`

## Book binary data lives in a separate store from metadata

**Context.** Listing books should not load every file into memory; old records stored the ArrayBuffer inline in the metadata record.

**Decision.** BookMeta is stored in bookStore and file bytes in bookDataStore; the Book type (meta + data) is deprecated for listings. getBookData lazily migrates old records by moving inline data to bookDataStore and stripping it from the metadata record. If no local data exists and remoteFileUrl is set, the file (and cover, best effort) is downloaded on demand, cached, and hasLocalFile is set.

**Consequences.** Listings are cheap; first open of a synced book requires a download.

**Code.** `app/lib/stores/book-store.ts#getBookData`

## Track uploaded chapter text with a versioned per-book marker

**Context.** Extracted chapter text is uploaded to POST /api/books/:bookId/chapters; re-uploading on every open is wasteful.

**Decision.** Store CHAPTER_UPLOAD_CACHE_VERSION per book in a lazily created IDB store; a book counts as uploaded only if the marker equals the current version.

**Consequences.** Bumping the version forces re-upload for all books.

**Code.** `app/lib/stores/chapter-upload-cache-store.ts`

## Cover cache eviction is best-effort

**Context.** Replacing a book cover evicts cached copies from the service worker cover caches; Cache Storage calls can fail or be unavailable.

**Decision.** evictFromCache swallows all errors so a failed eviction never breaks the cover replace flow.

**Consequences.** A stale cached cover can occasionally survive a replace until the cache entry expires.

**Code.** `app/lib/sw-cache.ts#evictFromCache`

## Guard IndexedDB entry tuples before destructuring

**Context.** Corrupted or mocked IndexedDB walks can return missing or malformed [key, value] tuples.

**Decision.** isWellFormedEntry checks the entry is an array of length >= 2 and callers skip entries that fail, so one bad row cannot crash local flows.

**Consequences.** Malformed rows are silently skipped in backfills, change-log reads and merges.

**Code.** `app/lib/sync/idb-entry.ts#isWellFormedEntry`

## Lazy per-entity IndexedDB stores

**Context.** createStore() at module scope throws during SSR because indexedDB is undefined in Node. idb-keyval supports only one object store per database.

**Decision.** All IDB stores are exposed through lazy getter functions in app/lib/sync/stores.ts that call createStore on first access, and each entity gets its own database (e.g. ebook-reader-books, ebook-reader-highlights).

**Consequences.** Modules can import store accessors safely on the server; adding an entity means adding a new database and getter here, never a module-scope createStore.

**Code.** `app/lib/sync/stores.ts`

## Reading history keys are bookId:ulid

**Context.** Reading history entries are stored in a flat idb-keyval database.

**Decision.** Keys in ebook-reader-reading-history are `${bookId}:${ulid}` so entries are unique per event and sort chronologically within a book prefix.

**Consequences.** Per-book queries scan keys by bookId prefix.

**Code.** `app/lib/sync/stores.ts#getReadingHistoryStore`

## Private blob downloads are proxied through the server

**Context.** Book files and covers are stored as private Vercel Blobs.

**Decision.** GET /api/sync/files/download (bookId, type=file|cover) fetches via get() with the access token and streams the body to the client.

**Consequences.** Server bandwidth is used for every download; blobs are never public.

**Code.** `app/routes/api.sync.files.download.ts#loader`

## CLI acquires blob upload tokens via the authenticated client

**Context.** Vercel Blob uploads need a scoped client token.

**Decision.** The CLI requests the token from /api/sync/files/upload through its redirect-safe authenticated client rather than a raw fetch.

**Consequences.** Credentials are not forwarded across redirects.

**Code.** `packages/cli/src/upload.ts`
