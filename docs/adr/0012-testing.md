# ADR 0012: Testing decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Minimal renderHookSimple helper instead of @testing-library/react

**Context.** Chat hook tests need to call hooks without depending on @testing-library/react.

**Decision.** renderHookSimple renders a component once with flushSync and returns the hook result.

**Consequences.** Only usable for hooks that do not need re-renders.

**Code.** `app/components/chat/__tests__/render-hook-simple.ts#renderHookSimple`

## Import useChatToolHandlers dynamically after vi.mock setup

**Context.** The hook module imports useWorkspace and services at load; the mocks reference module-level variables declared in the test.

**Decision.** The test awaits import("../use-chat-tool-handlers") after all vi.mock calls.

**Consequences.** Converting it to a static import breaks the mocks.

**Code.** `app/components/chat/__tests__/use-chat-tool-handlers.test.ts`

## Review progress excluding an assignment keeps its historical draft

**Context.** A successful progress response may omit an assignment the user already drafted.

**Decision.** The reducer keeps the existing draft when a progress update does not include the assignment; the test covers success then failed retry.

**Consequences.** Drafts are not lost on partial progress payloads.

**Code.** `app/components/review/review.test.tsx`

## Library browse card tests force the saved Grid view

**Context.** The library defaults to a non-grid view, but these tests check card layout.

**Decision.** Seed localStorage app-ui-settings with libraryView "grid" in beforeEach.

**Consequences.** Tests exercise the saved-preference path; changing the default view does not break them.

**Code.** `app/components/workspace/__tests__/library-browse-content.test.tsx#beforeEach`

## Reader preference tests wait on the IndexedDB read inside act

**Context.** The hook loads preferences from IndexedDB asynchronously and then sets state.

**Decision.** After rendering, await preferencesStore.getBookPreferences inside act so the load and the state updates it causes are flushed.

**Consequences.** Assertions see loaded settings without arbitrary timers.

**Code.** `app/hooks/use-book-reader-preferences.test.tsx#renderPreferences`

## Review browser integration test is opt-in against a production preview

**Context.** Driving the real review UI needs a deployed build, but tests must not touch shared data.

**Decision.** The test runs only when REVIEW_BROWSER_URL is set, targeting a stable production preview, while all API data is served from a fresh PGlite instance.

**Consequences.** Skipped in normal CI; when enabled it exercises a real build without polluting a real database.

**Code.** `app/lib/review/__tests__/review-browser.integration.test.ts`

## Review fixture fakes only sync book registration

**Context.** Review routes require a book owned by the user, normally created through sync.

**Decision.** The fixture inserts readmax.book rows directly for the sync registration call; chapter text still goes through the real upload route.

**Consequences.** Upload and review paths stay real; sync is out of scope for these tests.

**Code.** `app/lib/review/__tests__/review-http-fixture.ts#reviewHttpFixture`

## Review fixture simulates model offset miscount

**Context.** A live model sample returned an annotation whose UTF-16 end offset was miscounted relative to its quote.

**Decision.** The fake grader returns an annotation with end: 3 for a 4-char quote to exercise the offset-repair path.

**Consequences.** Tests cover the repair logic in review-model.server.ts.

**Code.** `app/lib/review/__tests__/review-http-fixture.ts#reviewHttpFixture`

## Review HTTP fixture uses real routes and SQL, doubling only the pool and AI

**Context.** Review integration tests should exercise production behavior as closely as possible.

**Decision.** reviewHttpFixture uses actual cookie auth, upload/review routes and SQL (on PGlite); only the database pool and the AI provider are test doubles.

**Consequences.** High-fidelity tests; DATABASE_URL is stubbed to an isolated value.

**Code.** `app/lib/review/__tests__/review-http-fixture.ts#reviewHttpFixture`

## Live review model sample is explicit opt-in and bounded

**Context.** Calling the production review model costs money and needs network access.

**Decision.** Runs only with RUN_REVIEW_LIVE_SAMPLE=1; at most two generations and six grades, no retries, no external DB.

**Consequences.** Bounded cost; never runs by default.

**Code.** `app/lib/review/__tests__/review-live.integration.test.ts`

## Live review sample observes SDK results without altering them

**Context.** Model anchors were being rejected by production validation and needed diagnosis.

**Decision.** The live test mocks 'ai' with a pass-through wrapper that records schema name, object and error name without changing results.

**Consequences.** Diagnostics are available without changing production behavior.

**Code.** `app/lib/review/__tests__/review-live.integration.test.ts`

## Spy AbortSignal.timeout to use fake timers

**Context.** Node's AbortSignal.timeout uses native timers that vitest fake timers do not control.

**Decision.** Intercept only AbortSignal.timeout construction and back it with setTimeout + AbortController.

**Consequences.** Timeout behavior can be tested with fake time.

**Code.** `app/lib/review/__tests__/review-model.test.ts`

## Keep pull cursor parsing outside the route module

**Context.** The pull route imports server-only database modules, which makes unit tests heavy.

**Decision.** PULL_ENTITY_TYPES, parseCursorsParam and the cursor encode/decode helpers live in app/lib/sync/sync-cursors.ts rather than the route file so they can be unit-tested without importing database code.

**Consequences.** The supported entity list is defined here and must stay in sync with SYNCABLE_ENTITIES in pull.ts.

**Code.** `app/lib/sync/sync-cursors.ts#PULL_ENTITY_TYPES`

## Bookshelf volume must be a closed cuboid

**Context.** 3D book volumes are built from CSS faces.

**Decision.** Assert eight distinct corners, each shared by exactly three faces.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf-motion.spec.ts`

## Interrupted initial bookshelf drop must retire permanently

**Context.** Bookshelf books animate in on load.

**Decision.** The test pauses the drop animation partway, focuses away, and asserts it is retired rather than replayed.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf-motion.spec.ts`

## Click the projected 3D cover, not the layout box

**Context.** Bookshelf covers are CSS 3D-transformed; layout boxes differ from what a user sees.

**Decision.** Finish animations and click the center of the projected .bookshelf-top bounding box.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf.spec.ts`

## Queued scroll after reveal must not dismiss selection

**Context.** Scrolling a selected book into view fires a scroll event.

**Decision.** Dispatch a scroll on .bookshelf and assert the book stays selected.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf.spec.ts`

## Reselecting after Escape must not outline the 3D cover

**Context.** Escape keeps focus on the trigger.

**Decision.** Click again and assert .bookshelf-top has no outline.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf.spec.ts`

## Simulate Safari keeping search focused on book click

**Context.** Safari leaves the search field focused when a book is clicked.

**Decision.** Focus the textbox before clicking a book.

**Consequences.** Test remains deterministic.

**Code.** `e2e/bookshelf.spec.ts`

## Assert chat highlights via IndexedDB

**Context.** Iframe decorations may lag or be SVG; server text-anchor needs a verbatim passage.

**Decision.** Use a verbatim fixture passage and poll IndexedDB for a highlight row.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts`

## Chat seed helper tolerates non-JSON responses

**Context.** The seed endpoint may return non-JSON on failure.

**Decision.** Swallow JSON parse error and return status/text for assertion messages.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts`

## Mount notebook before append_to_notes

**Context.** Append callbacks are registered by the mounted notebook editor; renderer "always" keeps it mounted.

**Decision.** Open the Notes tab first, then return to Discuss and wait for an assistant bubble before checking.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts`

## Reload mid-stream to exercise chat resume

**Context.** Chat should recover in-flight streams.

**Decision.** After reload the panel fetches messages and reconnects via /api/chat/resume; assert completed assistant text.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts`

## Chat e2e seeds server chapter cache directly

**Context.** Client auto-upload of chapters has nondeterministic timing.

**Decision.** Seed FIXTURE_CHAPTERS (matching create-test-epub.mjs) via the browser fetch to /api/books/:id/chapters using the session cookie; use page.evaluate fetch because page.request bypasses the Vite dev middleware and 404s.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts#openBookAndChat`

## E2E waits for auto-open after upload

**Context.** Uploaded books auto-open.

**Decision.** Wait for reader toolbar / PDF canvas after upload instead of opening manually.

**Consequences.** Test remains deterministic.

**Code.** `e2e/chat.spec.ts#openBookAndChat`

## Demo onboarding leaves the app before logout

**Context.** Pending navigation/sync can race cleanup.

**Decision.** Navigate to /favicon.svg before posting logout; setup uses a real passkey account.

**Consequences.** Test remains deterministic.

**Code.** `e2e/demo-onboarding.spec.ts`

## Review teardown fixture uses real React cleanup order

**Context.** Store disposal ordering between parent provider and child hook matters.

**Decision.** Mount real provider/hook without an engine and verify parent passive cleanup disposes Store before the child's.

**Consequences.** Test remains deterministic.

**Code.** `e2e/fixtures/review-navigation-lifecycle.tsx#exerciseReviewTeardown`

## Review navigation fixture runs in a real browser

**Context.** Range/boundary behavior must be real.

**Decision.** No hand-written boundaries or DOM Range mocks; checks checkpoint restore on refresh, single-page continuation return, no bounce-forward after programmatic arrival, and blocked back-turn at first fragment.

**Consequences.** Test remains deterministic.

**Code.** `e2e/fixtures/review-navigation.ts#createReviewNavigationFixture`

## Virtual authenticator must precede credentials calls

**Context.** WebAuthn ceremonies in tests need a CDP virtual authenticator.

**Decision.** Install it before any navigator.credentials call.

**Consequences.** Test remains deterministic.

**Code.** `e2e/helpers/auth.ts#installVirtualAuthenticator`

## Reload after sign-in so AuthProvider starts authenticated

**Context.** AuthProvider resolves session async; chat panel shows Sign in CTA and skips chapter upload until authenticated.

**Decision.** Poll for session cookie then reload.

**Consequences.** Test remains deterministic.

**Code.** `e2e/helpers/auth.ts#registerAndSignIn`

## Skip auth/chat e2e without Postgres

**Context.** Without DATABASE_URL auth endpoints return 503.

**Decision.** skipIfAuthNotConfigured probes /api/auth/register-options and skips on 503.

**Consequences.** Test remains deterministic.

**Code.** `e2e/helpers/auth.ts#skipIfAuthNotConfigured`

## Bookshelf seeds remote covers

**Context.** WebKit test contexts cannot persist blobs.

**Decision.** Route a remote blob cover URL instead of local blobs.

**Consequences.** Test remains deterministic.

**Code.** `e2e/helpers/bookshelf.ts#seedShelf`

## Review helper drives chapter end via EPUB keyboard path

**Context.** Must work on both screen sizes; the question can replace the chapter mid-loop.

**Decision.** Use keyboard paging and poll for target or iframe visibility.

**Consequences.** Test remains deterministic.

**Code.** `e2e/helpers/review.ts`

## Login test simulates partial onboarding state

**Context.** Onboarding may save book metadata but not the EPUB/chat.

**Decision.** Seed IndexedDB with only metadata.

**Consequences.** Test remains deterministic.

**Code.** `e2e/login.spec.ts`

## Force clicks on transparent PDF text layer

**Context.** PDF text layer is transparent.

**Decision.** Triple-click spans with force:true.

**Consequences.** Test remains deterministic.

**Code.** `e2e/pdf.spec.ts`

## Mobile PDF panel labeled by Read tab

**Context.** Base UI labels the mobile book panel from its Read tab.

**Decision.** Query tabpanel "Read" not "Book surface".

**Consequences.** Test remains deterministic.

**Code.** `e2e/pdf.spec.ts`

## Review checkpoint blocks TOC navigation to adjacent fragment

**Context.** The review boundary flow pauses at a checkpoint after the first chapter fragment.

**Decision.** The E2E asserts that a direct Table of Contents jump to the adjacent fragment cannot reveal it while the checkpoint is active.

**Consequences.** Regressions that let TOC navigation bypass review admission fail this test.

**Code.** `e2e/review-boundary-flow.spec.ts`

## Wait for review surface to close before reopening it

**Context.** While "Back to chapter" restores position, the retained reader iframe overrides its parent's visibility.

**Decision.** The test waits until the review answer surface is gone before requesting review again, rather than relying on iframe visibility.

**Consequences.** Avoids a race where the iframe looks visible but restoration is still running.

**Code.** `e2e/review.spec.ts`

## Page state reads column position, not text, since columns share one document

**Context.** In paginated EPUB layout all columns belong to one document, and chapter changes can reset scrollLeft.

**Decision.** The mobile paging test derives page state from scroll geometry instead of document text.

**Consequences.** Page assertions remain valid across chapter boundaries.

**Code.** `e2e/workspace.spec.ts`

## Synthetic three-page fixture uses explicit column breaks and a forced remeasure

**Context.** A swipe test injects a synthetic section with three page markers; asynchronous resizes can reflow content into a different page count.

**Decision.** Each marker div after the first uses break-before: column so the fixture always has three pages, and the viewport is resized (to 391px) to force the navigator to remeasure the injected section.

**Consequences.** Stable page count independent of font metrics; test relies on resize triggering remeasure.

**Code.** `e2e/workspace.spec.ts`

## TOC entries may render in both sidebar and reader popover

**Context.** The table of contents is shown both in the sidebar and in the reader popover.

**Decision.** Tests select TOC entries with .first() to tolerate duplicates.

**Consequences.** Strict-mode locator errors avoided.

**Code.** `e2e/workspace.spec.ts`

## Reader toolbar signals that an uploaded book is ready

**Context.** Uploading the first book auto-opens it (handleBookAdded -> openBook).

**Decision.** E2E helper uploadAndOpenBook waits for the "Previous page" toolbar button to be attached as the readiness signal instead of navigating manually.

**Consequences.** Tests depend on auto-open-on-upload behavior; changing it requires updating the helper.

**Code.** `e2e/workspace.spec.ts#uploadAndOpenBook`

## Review navigation E2E serves the app source tree

**Context.** The integration needs the consuming app's extraction/admission bridge.

**Decision.** The spec starts a Vite server rooted at the repo with the app alias instead of the package-only demo.

**Consequences.** Package E2E depends on app sources.

**Code.** `packages/epub-successor/e2e/review-navigation-source.spec.ts`

## content-range unit tests use an HTML Window document

**Context.** happy-dom's detached XML documents bind Range to the wrong root.

**Decision.** Unit tests build fixtures with new Window().document; native XHTML parsing and mounted range geometry are covered by package E2E.

**Consequences.** Unit tests do not cover XHTML specifics.

**Code.** `packages/epub-successor/src/navigator/content-range.test.ts#fixture`

## Test asserts floor rather than round column mapping

**Context.** An element 90% into column 2.

**Decision.** Test asserts it stays on column 2.

**Consequences.** Guards off-by-one restore.

**Code.** `packages/epub-successor/src/navigator/paginated.test.ts`
