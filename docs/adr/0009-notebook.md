# ADR 0009: Notebook decisions

- Status: Accepted
- Date: 2026-11-20
- Source: code comments removed in the comment cleanup

## Notebook freshness after edit_notes comes only from server updatedAt

**Context.** An earlier version cached edit_notes results in IDB with a fabricated client Date.now() timestamp, which could make stale content look newer than the server copy.

**Decision.** The edit_notes path never calls Date.now(). It caches to IDB and dispatches sync:entity-updated only when the server output includes updatedAt. If the output has executed:true but no updatedAt, the editor still gets the authoritative content in memory, but there is no IDB write and no sync event, and a warning is logged. Tests spy on Date.now and cover the missing-updatedAt case.

**Consequences.** Missing server timestamps degrade to in-memory-only updates rather than corrupting sync ordering.

**Code.** `app/components/chat/use-chat-tool-handlers.ts#useChatToolHandlers`

## TipTap setContent is silent; removeHighlightReference is a user edit

**Context.** Programmatic content always comes from an authoritative server/sync snapshot. Emitting onUpdate for it would enqueue a newer local autosave that could overwrite a subsequent remote change.

**Decision.** setContent calls editor.commands.setContent with emitUpdate:false. removeHighlightReference deletes every highlightReference node for the id as a normal transaction so it is saved through onUpdate.

**Consequences.** Callers choose save semantics by method.

**Code.** `app/components/tiptap-editor.tsx#TiptapEditorHandle`

## Do not autosave notebook content applied from sync

**Context.** Applying a sync pull into the editor could trigger handleUpdate, which would autosave and echo remote content back as a newer local edit.

**Decision.** WorkspaceNotebook sets fromSyncRef while applying synced content and handleUpdate returns early while it is set; lastContentRef tracks the last known serialized content to skip no-op reconciles.

**Consequences.** Sync pulls never create local writes.

**Code.** `app/components/workspace-notebook.tsx#handleUpdate`

## Push live notebook edits to the chat panel

**Context.** The chat read_notes tool would otherwise read stale saved content during the autosave debounce.

**Decision.** handleUpdate converts the new content to markdown and calls the notebookContentChangeMap callback for the book.

**Consequences.** read_notes sees current editor content.

**Code.** `app/components/workspace-notebook.tsx#handleUpdate`

## Register notebook editor callbacks only after the editor is ready

**Context.** Chat tool handlers and highlight creation can write to the notebook through an imperative editor ref; before TipTap is ready that ref silently drops content.

**Decision.** appendHighlight and notebookEditorCallbackMap entries are registered only once editorReady is true; until then callers fall back to persisting via the saga/IndexedDB.

**Consequences.** No content lost during the loading window.

**Code.** `app/components/workspace-notebook.tsx#WorkspaceNotebook`

## Deleting a highlight edits the open notebook editor directly

**Context.** An open notebook saves on a debounce; if only storage is updated, the next save writes the highlight node back.

**Decision.** Call removeHighlightReference on the live editor from notebookEditorCallbackMap before dispatching deleteHighlightRequested.

**Consequences.** Deleted highlights stay gone; any new delete path must do the same.

**Code.** `app/hooks/use-highlight-context-menu.ts#deleteMenuHighlight`

## New highlights are appended to the stored notebook when no editor is mounted

**Context.** Highlight deletion UI lives on the notebook highlightReference node. If the notebook editor is not mounted to take an imperative append, a new highlight would have no node and no way to delete it.

**Decision.** appendHighlightReferenceToNotebook writes a highlightReference node plus a trailing empty paragraph (mirroring TiptapEditor.appendHighlightReference) to the notebook in IndexedDB, creating the notebook if needed. The annotations saga uses the returned notebook to update the normalized collection, including for highlights created by chat tools.

**Consequences.** Every highlight has a notebook node; the editor and storage paths must produce the same node shape.

**Code.** `app/lib/annotations/append-highlight-to-notebook.ts#appendHighlightReferenceToNotebook`

## Chat tool notebook writes seed the editor last-known content

**Context.** Chat tool handlers write notebook content through to IndexedDB and dispatch a sync:entity-updated {notebook} event while the editor is open. The editor would then call setContent with identical content and reset the cursor.

**Decision.** seedLastContent sets the editor last-known-content ref to the written content first, so the following sync event that reads the same content is a no-op.

**Consequences.** No cursor jump on chat-tool edits; any new write-through path must seed before dispatching.

**Code.** `app/lib/context/workspace-context.tsx#NotebookEditorCallbacks.seedLastContent`

## Separate client and server markdown-to-TipTap converters

**Context.** Constructing a TipTap Editor requires browser globals such as innerHeight, but the server also needs to convert markdown (AI notebook edits).

**Decision.** Client code uses markdownToTiptapJson, a headless Editor with the tiptap-markdown extension (inverse of tiptapJsonToMarkdown); it must run client-side only because it needs a DOM. Server code uses markdownToTiptapJsonServer: markdown-it renders HTML, linkedom builds a DOM, and ProseMirror's DOMParser with Tiptap's StarterKit schema produces JSON, without constructing an Editor.

**Consequences.** Two code paths can drift in output; server conversion supports only what StarterKit's schema parses.

**Code.** `app/lib/editor/markdown-to-tiptap-server.ts#markdownToTiptapJsonServer`

## Run AI edit_notes scripts in a node:vm context with a server DOM shim

**Context.** The chat edit_notes tool lets the model write JS against a notebook SDK. TipTap's Editor needs a DOM even headlessly, and the model's script must not reach host capabilities.

**Decision.** runEditNotesInSandbox runs AI-supplied code against a notebook SDK inside a node:vm context with a timeout; the context exposes only `notebook` and a no-op `console` (no require, network, fs or host globals). It returns { ok: true, updatedContent } or { ok: false, error } for any thrown error or timeout. The notebook SDK and server markdown converter are dynamically imported so TipTap/DOM work only runs when the tool is called. A minimal linkedom-based DOM shim is installed on globalThis the first time it is used (idempotent, safe per request); navigator may be a read-only getter in some runtimes so assigning it is allowed to fail.

**Consequences.** node:vm is a timeout/isolation convenience, not a hard security boundary. Installing DOM globals affects the whole server process.

**Code.** `app/lib/editor/notebook-sdk-server.ts#runEditNotesInSandbox`

## Reject AI notebook edits that shrink the document below 25%

**Context.** A common failure mode is an AI script that reassembles the whole notebook and drops most of it.

**Decision.** If the input has at least MIN_INPUT_BLOCKS_FOR_GUARD (3) top-level nodes and the result has fewer than SHRINK_FLOOR (0.25) times that count, the edit is rejected with an error telling the model to use targeted replace/remove/insert calls (or remove() in a loop for an explicit reset). Small notebooks (<3 blocks) are exempt so shrinking to 1 block is allowed; e.g. 3 -> 1 passes since 1 >= 0.75.

**Consequences.** Legitimate bulk deletions of more than 75% of a larger notebook require a block-by-block remove loop.

**Code.** `app/lib/editor/notebook-sdk-server.ts#SHRINK_FLOOR`

## Notebook SDK addresses blocks by generation-stamped JSON paths and mutates via JSON splice

**Context.** The AI-facing notebook SDK hands out Block handles, then mutates the document. ProseMirror positions shift after any mutation, and inserting via editor commands next to atom nodes can create empty-paragraph boundaries that swallow content.

**Decision.** Each Block records internal addressing: _pos (ProseMirror start, offset+1 because the doc node wraps content), _topLevelIndex, and for list items _parentTopLevelIndex, _listItemChildIndex and _jsonPath, a list of [listItemIdx, nestedListContentIdx] pairs from the top-level list to the item's parent list (empty for depth 0). Blocks carry the mutation generation they were read at; callers must re-read blocks after mutations, and a stale block is re-found against live blocks with a console warning. Mutations clone the JSON path and splice doc JSON, then setContent, rather than using positional editor commands, to avoid atom-to-empty-paragraph boundaries swallowing content. Regex queries reset lastIndex before test() so g/y flags don't skip matches. If an error is thrown mid-script, earlier mutations remain in editor state, so callers must not call getResult/save after an error.

**Consequences.** Handles are cheap but stale handles silently re-resolve by text; callers own discarding partial results on error.

**Code.** `app/lib/editor/notebook-sdk.ts#createNotebookSDK`

## HighlightReference receives its React component via extension options

**Context.** The TipTap highlight node needs a React node view component that itself imports editor modules.

**Decision.** The component is passed via HighlightReference extension options instead of imported, avoiding circular imports; addNodeView throws if it is missing. Headless/server usage overrides the node view with a plain div.

**Consequences.** Every editor using HighlightReference must configure the component option.

**Code.** `app/lib/editor/tiptap-highlight-node.ts#HighlightReference`

## append_to_notes persists immediately instead of via debounced save

**Context.** When the notebook editor was open, appends only triggered a debounced save; if the panel unmounted before the debounce fired, appended content was lost.

**Decision.** After append_to_notes merges content, saveNotebook is called immediately so a getNotebook right after returns the updated content.

**Consequences.** Appends survive panel close/unmount; one extra write per append.

**Code.** `app/lib/stores/__tests__/annotations-store.test.ts`

## Notebook AI tools fall back to IndexedDB when the editor is not ready

**Context.** During the loading window the notebook panel is mounted but TipTap has not initialised, so notebookEditorCallbackMap has no entry for the book.

**Decision.** append_to_notes and edit_notes fall back to an IndexedDB read-merge-write path and read the real stored notebook content, never an empty placeholder.

**Consequences.** Tool mutations during load operate on real data and produce correct merged content.

**Code.** `app/lib/stores/__tests__/annotations-store.test.ts`

## Notebook content is validated only structurally

**Context.** Notebook content is a TipTap JSONContent tree whose structure is owned by the editor.

**Decision.** decodeNotebook only checks that content is a record; it does not deeply schema-check the tree.

**Consequences.** Invalid trees are caught by the editor, not the store; schema changes in TipTap do not break decoding.

**Code.** `app/lib/stores/annotations-store.ts#Notebook`

## edit_notes surfaces LWW conflicts instead of fabricating timestamps

**Context.** upsertNotebook returns null when the server already has a newer row (LWW filter).

**Decision.** Do not invent an updatedAt; return a conflict so the client skips its cache write, mirroring the server-authoritative model.

**Consequences.** Clients keep the newer server version; edits that lose LWW are dropped with a warning.

**Code.** `app/routes/api.chat.ts#action`

## Highlight delete button is hidden by opacity until hover

**Context.** The notebook highlight reference shows its delete control only on hover via opacity.

**Decision.** Tests click it with force: true.

**Consequences.** Visual-only hiding; control remains in the accessibility tree.

**Code.** `e2e/workspace.spec.ts`

## Highlights created with the notebook closed persist via IDB fallback

**Context.** Regression: highlights created before the notebook editor was mounted had no notebook node and could not be deleted.

**Decision.** When the editor is not mounted, appendHighlightReferenceToNotebook writes the highlightReference into IndexedDB. The E2E creates a highlight without opening Notes, then asserts exactly one blockquote appears (no double-write) and that delete works on the fallback-created node.

**Consequences.** Two write paths must not both fire for one highlight.

**Code.** `e2e/workspace.spec.ts`

## Opening the Notes rail registers the notebook callback map

**Context.** Highlights appended to the notebook go through notebookCallbackMap when the editor is mounted.

**Decision.** The highlight E2E opens the Notes tab first so the imperative append path (notebookCallbackMap) is exercised; a separate test covers the closed-notebook fallback.

**Consequences.** Both append paths have coverage.

**Code.** `e2e/workspace.spec.ts`
