# ADR 0013: Other decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Review annotation offsets index the immutable submitted text

**Context.** Review annotations carry start/end offsets and a quote; the client could trim or alter the text.

**Decision.** Offsets always refer to the server's immutable, untrimmed submitted plainText. ReviewFeedback drops annotations whose range is invalid or whose slice does not equal the quote.

**Consequences.** The client must never trim plainText before applying offsets; mismatched annotations are hidden rather than misplaced.

**Code.** `app/components/review/review-feedback.tsx#ReviewFeedback`

## Redux owns the review draft; TipTap is synced one-way

**Context.** The review answer is edited in a TipTap widget but the draft lives in the store.

**Decision.** An effect pushes the store document into the editor only when its JSON differs; Redux remains the source of truth.

**Consequences.** Avoids cursor resets from redundant setContent calls.

**Code.** `app/components/review/review-page.tsx#ReviewPage`

## Empty Standard Ebooks query shows popular books

**Context.** The browser needs content before the user types.

**Decision.** StandardEbooksService.searchBooks treats an empty query as a request for popular books.

**Consequences.** No separate popular-books call path.

**Code.** `app/components/standard-ebooks-browser.tsx#StandardEbooksBrowser`

## Review chapter fingerprint hashes content only

**Context.** Questions are shared across users who have the same chapter text.

**Decision.** fingerprintReviewChapter hashes the entire normalized chapter text, excluding user, book, title and locator metadata.

**Consequences.** Identical text in different books/users shares a fingerprint and questions.

**Code.** `app/lib/review/chapter-identity.ts#fingerprintReviewChapter`

## Review chapter text normalization

**Context.** Chapter text from different packaging can differ in whitespace.

**Decision.** normalizeReviewChapterText applies NFC and collapses whitespace only, preserving case, punctuation, accents and word order.

**Consequences.** Fingerprints are stable across packaging but sensitive to real textual changes.

**Code.** `app/lib/review/chapter-identity.ts#normalizeReviewChapterText`

## Shared plain-text convention for review documents

**Context.** Annotation offsets from the judge must map back to the editor's document.

**Decision.** reviewDocumentPlainText defines the single stable plain-text/annotation convention used by both the editor and the judge.

**Consequences.** Changing it breaks stored annotation offsets.

**Code.** `app/lib/review/review-schemas.ts#reviewDocumentPlainText`

## Review annotation offsets refer to untrimmed plainText

**Context.** Answers have a rich document and a plain-text form.

**Decision.** ReviewAnswerSnapshot.plainText is the untrimmed canonical text of document; annotation offsets index this exact string.

**Consequences.** Trimming plainText would break annotations.

**Code.** `app/lib/review/review-types.ts#ReviewAnswerSnapshot`

## Review chapter locator semantics

**Context.** Review chapters are located in the book for slicing text and identity.

**Decision.** ReviewChapterPoint offsets are UTF-16 offsets into trimmed source body.textContent, never viewport page numbers. ReviewChapterBoundary.key is a book-local locator identity unrelated to the global content fingerprint; end is exclusive and null means end of publication; startOffset/endOffset slice the enclosing legacy BookChapter.text and include multi-spine separators.

**Consequences.** Locators are layout-independent; offsets depend on legacy BookChapter text format.

**Code.** `app/lib/review/review-types.ts#ReviewChapterBoundary`

## AppStoreProvider owns saga startup

**Context.** Themis lint forbids React components from importing saga modules.

**Decision.** AppStoreProvider is the root runtime: it starts all sagas (including createReviewsSaga and readingRailSaga) after store.init() and before children render, and tears them down on unmount, so it is the one allowed importer (with eslint-disable-next-line themis/react-forbidden-component-import).

**Consequences.** Other components must not import sagas; new sagas are registered in AppStoreProvider.

**Code.** `app/lib/themis/provider.tsx#AppStoreProvider`

## Review progress merge ignores server projections

**Context.** The review progress response includes derived fields (latest, pass, updatedAt) computed by the server.

**Decision.** mergeReviewProgress discards the wire latest/pass/updatedAt projections and keeps only normalized records, deriving those values locally from attempts.

**Consequences.** Client state has one source of truth per fact; server projections cannot drift from local records.

**Code.** `app/lib/themis/reviews/reviews-records.ts#mergeReviewProgress`

## Review request invalidation rules

**Context.** Review drafts, submissions and progress reads race; HTTP delivery order does not prove freshness.

**Decision.** Editing a draft clears the submit request but cannot cancel confirmation of a write that already completed; it invalidates in-flight progress reads for current assignments so they cannot import a not-yet-accepted grade. Starting any non-progress write invalidates in-flight progress reads, since a read begun before the write cannot reconcile its newer result. After a successful write the chapter source is invalidated and the saga fetches a fresh snapshot before the assignment can unlock.

**Consequences.** Extra progress fetches after writes; no stale grade import.

**Code.** `app/lib/themis/reviews/reviews-slice.ts`

## Review attempts are immutable normalized snapshots

**Context.** Server review attempts contain rich-text documents and annotations.

**Decision.** ReviewAttempt stores the document as opaque JSON (documentJson) and normalizes annotations into a Collection keyed by id; attempts are never mutated locally.

**Consequences.** Rendering parses documentJson; annotation updates replace whole attempts.

**Code.** `app/lib/themis/reviews/reviews-types.ts#ReviewAttempt`

## Current review assignments are tracked separately from history

**Context.** The review cache retains historical assignments after they leave the current set.

**Decision.** ReviewCache.currentAssignmentIds holds the server-authorized current membership; the assignments collection may also contain retained historical records.

**Consequences.** UI must filter by currentAssignmentIds, not by the assignments collection.

**Code.** `app/lib/themis/reviews/reviews-types.ts#ReviewCache`

## Review checkpoints store an opaque return locator

**Context.** Review checkpoints need to send the reader back to where they were.

**Decision.** ReviewCheckpoint.returnLocator is an opaque reader locator (currently an EPUB CFI) owned by navigation; review code never parses it.

**Consequences.** Supporting PDFs or other formats needs no review-state change.

**Code.** `app/lib/themis/reviews/reviews-types.ts#ReviewCheckpoint`

## Local review source fingerprints are independent of server history

**Context.** Review assignments are tied to chapter source fingerprints; the local EPUB may differ from what the server saw.

**Decision.** ReviewsState.localSources holds fingerprints observed in the active local EPUB and is kept separate from server records.

**Consequences.** Mismatches between local and server sources can be detected and repaired.

**Code.** `app/lib/themis/reviews/reviews-types.ts#ReviewsState`

## Persist review submission identity before submit

**Context.** The server may commit a review attempt even if the client crashes or loses the response.

**Decision.** The submit worker saves the review cache (including the prepared submission/retry identity) to IndexedDB before calling reviewClient.submit.

**Consequences.** A retry after reload reuses the same identity and the server can dedupe it.

**Code.** `app/lib/themis/reviews/sagas/reviews-saga.ts#createReviewsSaga`

## Reviews root saga blocks until cancellation

**Context.** Cleanup of online/offline listeners lives in the root saga's finally block.

**Decision.** After forking watchers and hydrating, the root saga awaits a never-resolving promise so finally runs only on cancellation.

**Consequences.** Listener cleanup is tied to saga cancellation by AppStoreProvider.

**Code.** `app/lib/themis/reviews/sagas/reviews-saga.ts#createReviewsSaga`

## Reviews saga is created per store

**Context.** Themis guidance avoids module-global Store references.

**Decision.** createReviewsSaga(store) binds selectors and dispatch once to the given AppStore; no module-global store is used.

**Consequences.** Tests can create isolated stores; AppStoreProvider creates the saga.

**Code.** `app/lib/themis/reviews/sagas/reviews-saga.ts#createReviewsSaga`

## Validate review scope before cancelling work

**Context.** Review operations use takeLatest-like cancellation; callers from a previous book scope can still dispatch.

**Decision.** watchOperation checks the request generation/scope before cancelling a pending task.

**Consequences.** Stale dispatches cannot abort the current book's in-flight request.

**Code.** `app/lib/themis/reviews/sagas/reviews-saga.ts#createReviewsSaga`

## Review requests repair missing chapters once

**Context.** Review API calls can fail with chapters_unavailable when the server lacks extracted chapter text.

**Decision.** withChapterRecovery reuploads book chapters and retries the request once; if the repair itself fails, the original chapters_unavailable error is rethrown since repair failure does not change the server finding.

**Consequences.** At most one retry per request; callers see the server's error, not the upload error.

**Code.** `app/lib/themis/reviews/sagas/reviews-saga.ts#withChapterRecovery`

## CLI does not print HTML error bodies

**Context.** Servers/proxies may return HTML error pages.

**Decision.** On a non-OK response the CLI only uses a JSON "error" string field; unparsable bodies are ignored and only status is reported.

**Consequences.** Error output stays readable in terminals.

**Code.** `packages/cli/src/client.ts`

## CLI downloads write beside destination then publish atomically

**Context.** A partial download must not replace or appear as the output file.

**Decision.** writeOutput writes to a temporary file next to the destination and renames only when the download completes.

**Consequences.** No half-written files on interruption.

**Code.** `packages/cli/src/output.ts#writeOutput`

## CLI activity status is stderr-only and non-animated off TTY

**Context.** Progress spinners corrupt piped output and CI logs.

**Decision.** Activity writes transient status to stderr only when it is a TTY. Lines are clipped to terminal width; labels are CLI-controlled (passed through clean()), so clipping cannot split user metadata or escape sequences.

**Consequences.** stdout stays machine-readable.

**Code.** `packages/cli/src/terminal.ts#Activity`

## Cover extraction failures do not block CLI import

**Context.** EPUB covers can be missing or exceed the 5 MB limit.

**Decision.** The CLI swallows cover extraction errors and imports the book without a cover.

**Consequences.** Books import even with broken covers.

**Code.** `packages/cli/src/upload.ts`
