# ADR 0007: Workspace decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Register placeholder book navigation before the reader is ready

**Context.** Other panels (chat, notebook) can request navigation to a CFI before book metadata loads and the rendition exists; the navigation map would have no entry and the request would be lost.

**Decision.** WorkspaceBookReader registers a stable placeholderNav in navigationMap immediately. Until WorkspaceBookReaderInner calls onRenditionReady with the real navigateToCfi (stored in realNavRef), the placeholder stores the latest CFI in pendingCfiRef; onRenditionReady drains it.

**Consequences.** Only the most recent pending CFI is kept; navigation requests are never dropped during loading.

**Code.** `app/components/workspace-book-reader.tsx#WorkspaceBookReader`

## PDF reader opens notebook and chat through the workspace-level openers

**Context.** Focused mode has cluster rules (add a tab in the right group, no splitting).

**Decision.** handleOpenNotebook and handleOpenChat call ws.openNotebookRef / ws.openChatRef instead of opening panels themselves.

**Consequences.** Cluster rules apply the same way for every reader.

**Code.** `app/hooks/use-pdf-workspace-panels.ts#handleOpenNotebook`

## A BookCluster groups one book reader with its chat and notebook panels

**Context.** Link navigation must resolve which chat belongs to which book.

**Decision.** BookCluster holds the book reader panel (left) and optional chat and notebook tab panels (right); exactly one cluster is visible at a time.

**Consequences.** Cross-panel navigation goes through clusters; layout code must keep clusters in sync with panels.

**Code.** `app/lib/context/workspace-context.tsx#BookCluster`

## Cross-panel navigation activates the owning cluster first

**Context.** A book reader only registers its navigation callback when its panel is mounted and visible.

**Decision.** navigateInCluster switches to the cluster for bookId if it is not active, waits for the reader to register, then calls it with target: a CFI for EPUB or "page:N" for PDF.

**Consequences.** Links from chat or notebook work for books that are not on screen; target strings are format-specific.

**Code.** `app/lib/context/workspace-context.tsx#navigateInCluster`

## openBookIdsRef is read on subscribeClusterChanges

**Context.** The set of open books changes with the reading route, but it is a ref and does not trigger renders.

**Decision.** openBookIdsRef holds the IDs of books on the current reading route; consumers re-read it when subscribeClusterChanges fires.

**Consequences.** Consumers stay current without re-rendering the whole workspace.

**Code.** `app/lib/context/workspace-context.tsx#WorkspaceContextValue.openBookIdsRef`

## Adopted demo chat session always gets a fresh id

**Context.** When a signed-out visitor signs in, demo content is adopted into their account. The user may already have created their own chat session that took over activeSessionId.

**Decision.** The adopted demo session is always assigned crypto.randomUUID() instead of reusing the demo session id.

**Consequences.** No collision with a user-created session or the fixed demo id; references to the demo session id must be remapped.

**Code.** `app/lib/onboarding/adopt-demo.ts#createAdoptedSnapshot`

## Route sync reads books from store state directly

**Context.** Throttled render selectors may not yet include hydrated or newly added books when a route change runs.

**Decision.** Pass store.booksSelectors.selectAllBooks.select(store.state) instead of the rendered books list.

**Consequences.** Opening a just-added book by route works without waiting for a render.

**Code.** `app/routes/app-frame.tsx#AppFrame`

## Leaving library aborts pending open unless handing off to a book

**Context.** A book open started from the library may still be pending when the route unmounts.

**Decision.** On unmount, abort the pending open controller only if the new path is not a reading route.

**Consequences.** The /library -> /books/:id handoff completes; other navigations cancel the open.

**Code.** `app/routes/workspace-library.tsx#WorkspaceLibrary`
