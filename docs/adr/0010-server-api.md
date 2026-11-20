# ADR 0010: Server API decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Unauthenticated requests throw a uniform 401 auth_required body

**Context.** API clients need to detect missing auth consistently across many loaders/actions.

**Decision.** requireAuth throws Response.json({ error: "auth_required" }, { status: 401 }) for every unauthenticated request so clients can pattern-match a single shape across routes.

**Consequences.** Routes must not invent their own unauthenticated error bodies; clients key on error === 'auth_required'.

**Code.** `app/lib/database/auth-middleware.ts#requireAuth`

## Chapter review attempts are immutable, server-graded and append-once

**Context.** Chapter review (comprehension checkpoints) grades user answers with a model. Progress and pass state must not be forgeable by the client, retries must be safe, and the rubric must stay private.

**Decision.** Only a server-produced judgment is recorded (recordReviewAttempt); no client mutation can set progress or pass directly. Attempts are inserted with an FK binding question, source fingerprint and checkpoint, and a unique (user_id, id) key makes repeated or concurrent requests append once without overwriting an existing result; getReviewAttempt is an owner-scoped lookup used for idempotent retries before calling the model. Passing/latest progress columns are projections of immutable attempts, not independently writable grades. A checkpoint keeps its first assigned question even if a later request changes difficulty (startReviewProgress). Generated questions are saved first-writer-wins under a unique reuse key; losers return the persisted winner. ReviewQuestionRecord (with rubric) is a private server record and must never be returned directly from an endpoint. Review sources are the complete normalized chapter slice, never a preview or truncated chat window; getOwnedReviewChapter returns null uniformly for unavailable, deleted, non-EPUB, unowned and legacy/unresolved sources.

**Consequences.** Grades are auditable and replay-safe; endpoints must map records to DTOs; callers cannot distinguish why a source is unavailable.

**Code.** `app/lib/database/review/review-attempts.server.ts#recordReviewAttempt`

## Bound page-increment workflow below queue lease TTL

**Context.** Page increment jobs run under a queue lease; each provider call has its own timeout but the overall workflow could exceed the lease.

**Decision.** Wrap the whole workflow in AbortSignal.timeout(240_000), below the queue lease TTL.

**Consequences.** Jobs abort before the lease expires so another worker does not pick up a still-running job.

**Code.** `app/lib/reading-agent/page-increment.server.ts`

## Bound review request size and depth before validation

**Context.** Review requests contain recursive rich-text documents; parsing or validating huge or deeply nested input is a DoS risk.

**Decision.** readReviewRequest rejects bodies over MAX_REQUEST_BYTES (4 MB) before parsing and bounds nesting depth before recursive zod validation.

**Consequences.** Oversized or deeply nested requests fail fast.

**Code.** `app/lib/review/review-api.server.ts#readReviewRequest`

## Review API responses are always private, no-store

**Context.** Review responses contain per-user data, including GET results.

**Decision.** reviewApi sets Cache-Control: private, no-store on every success and failure.

**Consequences.** No shared caching of review responses.

**Code.** `app/lib/review/review-api.server.ts#reviewApi`

## Review answer length counts Unicode code points

**Context.** PostgreSQL length() counts code points, while JS string length counts UTF-16 units.

**Decision.** canSubmitReviewAnswer uses Array.from(text.trim()).length so client and DB checks agree.

**Consequences.** Client and server minimum-length checks are consistent.

**Code.** `app/lib/review/review-schemas.ts#canSubmitReviewAnswer`

## Return the winning concurrent review question assignment

**Context.** Concurrent requests may assign questions at different difficulties.

**Decision.** After assignment, re-read progress and return the question it points to (the winner), not the one this request created.

**Consequences.** Clients converge on one assigned question.

**Code.** `app/lib/review/review-service.server.ts`

## Review attempt persistence arbitrates concurrency

**Context.** Attempts can race with source changes and duplicate retries.

**Decision.** recordReviewAttempt rechecks assignment and source and arbitrates concurrent attempt ids; the service also rechecks source before and after.

**Consequences.** Concurrency correctness lives in the persistence layer.

**Code.** `app/lib/review/review-service.server.ts`

## Review passes do not survive chapter text replacement

**Context.** Chapter text can be replaced after a user passed a review.

**Decision.** Progress is filtered against the current source fingerprint; historical attempts remain stored but cannot restore a pass for replaced text.

**Consequences.** Users must re-pass after chapter text changes.

**Code.** `app/lib/review/review-service.server.ts`

## review-types holds only wire/persistence contracts

**Context.** Review types are imported by both server code and the browser.

**Decision.** review-types.ts contains only wire and persistence contracts with no server or browser dependencies.

**Consequences.** Safe to import during SSR and in the browser; logic belongs elsewhere.

**Code.** `app/lib/review/review-types.ts`

## Review question request has no client-supplied content

**Context.** Clients could tamper with chapter text, fingerprint, rubric or model.

**Decision.** POST /api/reviews/question accepts only bookId, chapterKey and difficulty; the server derives text, fingerprint, rubric and model.

**Consequences.** Clients cannot influence grading inputs.

**Code.** `app/lib/review/review-types.ts#ReviewQuestionRequest`

## Review attempt id is an idempotency key

**Context.** Transport retries can resend the same attempt.

**Decision.** ReviewSubmitRequest.id is client-generated and retained across retries as an idempotency key.

**Consequences.** Retries never create duplicate attempts.

**Code.** `app/lib/review/review-types.ts#ReviewSubmitRequest`

## Read pending outline progress before artifacts

**Context.** Outline jobs complete asynchronously; reading artifacts first could miss a job that finishes between queries.

**Decision.** Query listPendingOutlinePages before getCurrentReadingArtifacts.

**Consequences.** A job completing mid-request shows up as either pending or as content, never vanishing.

**Code.** `app/routes/api.books.$bookId.artifacts.ts#loader`

## Standard Ebooks download validates path and final host

**Context.** The download proxy builds a URL from a client-supplied path (SSRF risk).

**Decision.** isValidEbookPath allows only /ebooks/ paths of [a-zA-Z0-9/_-] ending in an alphanumeric (no periods); additionally the constructed URL hostname must equal standardebooks.org.

**Consequences.** Two independent layers block SSRF; paths with dots are rejected.

**Code.** `app/routes/api.standard-ebooks.download.ts#loader`

## Skip unreleased Standard Ebooks entries via placeholder-cover

**Context.** Search results include not-yet-public-domain/wanted/in-production books.

**Decision.** Drop list items containing .placeholder-cover instead of a real cover.

**Consequences.** Depends on Standard Ebooks markup; a markup change could let placeholders through.

**Code.** `app/routes/api.standard-ebooks.search.ts#parseResults`
