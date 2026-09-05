import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor, JSONContent } from "@tiptap/react";
import { createStore } from "idb-keyval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotebookEditorCallbacks } from "~/lib/context/workspace-context";
import type { HighlightReferenceAttrs } from "~/lib/editor/tiptap-highlight-node";
import {
  AnnotationService,
  makeAnnotationService,
  type Notebook,
} from "~/lib/stores/annotations-store";
import { annotationsSaga } from "~/lib/themis/annotations/annotations-sagas";
import {
  hydrateAnnotationsRequested,
  updateNotebookRequested,
} from "~/lib/themis/annotations/annotations-slice";
import { createAppStore, type AppStore } from "~/lib/themis/store";

const context = vi.hoisted(() => ({
  store: null as AppStore | null,
  notebookCallbackMap: { current: new Map<string, (attrs: HighlightReferenceAttrs) => void>() },
  notebookEditorCallbackMap: { current: new Map<string, NotebookEditorCallbacks>() },
  notebookContentChangeMap: { current: new Map<string, (markdown: string) => void>() },
  navigateInCluster: vi.fn(),
  removeHighlightAnnotationForBook: vi.fn(),
}));

// Only replace the surrounding workspace/provider. Editors, selectors, reducers,
// sagas, sync notifications, and the annotation service's IDB writes are real.
vi.mock("~/lib/themis/provider", () => ({ useAppStore: () => context.store }));
vi.mock("~/lib/context/workspace-context", () => ({ useWorkspace: () => context }));

import { WorkspaceNotebookPanel } from "~/components/workspace/panel-components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.getAnimations = () => [];

let root: Root;
let container: HTMLDivElement;
let store: AppStore;
let service: ReturnType<typeof makeAnnotationService>;

function documentWith(text: string): JSONContent {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function renderBook(bookId: string) {
  await act(async () => {
    root.render(<WorkspaceNotebookPanel bookId={bookId} bookTitle={bookId} chromeless />);
  });
}

async function settle(assertion: () => void | Promise<void>) {
  let failure: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    // Let IDB complete and ReactStore's scheduled selector emissions reach React.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      await assertion();
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function editor() {
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  expect(element).not.toBeNull();
  return element!.editor;
}

async function edit(text: string) {
  await act(async () => {
    editor().commands.insertContent(text);
  });
  return editor().getJSON();
}

async function seed(bookId: string, text: string) {
  await service.cacheNotebook({ bookId, content: documentWith(text), updatedAt: 1 });
}

async function hydrate(bookId: string) {
  store.dispatch(hydrateAnnotationsRequested(bookId));
  await settle(() => {
    expect(store.annotationsSelectors.selectAnnotationsLoaded.select(store.state, bookId)).toBe(
      true,
    );
  });
}

async function syncNotebook(bookId: string, content: JSONContent) {
  await service.cacheNotebook({ bookId, content, updatedAt: Date.now() + 100 });
  await act(async () => {
    await new Promise<void>((resolve) =>
      queueMicrotask(() => {
        window.dispatchEvent(
          new CustomEvent("sync:entity-updated", { detail: { entity: "notebook" } }),
        );
        resolve();
      }),
    );
  });
}

beforeEach(() => {
  context.navigateInCluster.mockClear();
  const suffix = crypto.randomUUID();
  service = makeAnnotationService({
    highlightStore: createStore(`notebook-integration-highlights-${suffix}`, "highlights"),
    notebookStore: createStore(`notebook-integration-notebooks-${suffix}`, "notebooks"),
  });
  vi.spyOn(AnnotationService, "getHighlightsByBook").mockImplementation(
    service.getHighlightsByBook,
  );
  vi.spyOn(AnnotationService, "getNotebook").mockImplementation(service.getNotebook);
  vi.spyOn(AnnotationService, "saveNotebook").mockImplementation(service.saveNotebook);
  store = createAppStore();
  context.store = store;
  store.init();
  store.runSaga(annotationsSaga);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  store.dispose();
  context.store = null;
  context.notebookCallbackMap.current.clear();
  context.notebookEditorCallbackMap.current.clear();
  context.notebookContentChangeMap.current.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("notebook book ownership through the workspace panel", () => {
  it.each([false, true])(
    "isolates edits when switching to a hydrated B (nonempty: %s)",
    async (nonempty) => {
      await seed("a", "Private notes for A");
      if (nonempty) await seed("b", "Existing notes for B");
      await hydrate("a");
      await hydrate("b");
      const beforeB = await service.getNotebook("b");
      await renderBook("a");
      const oldEditor = editor();
      const pendingA = await edit(" Pending A edit");
      const saveGate = deferred<void>();
      const savedA = deferred<Notebook>();
      vi.mocked(AnnotationService.saveNotebook).mockImplementationOnce(async (notebook) => {
        await saveGate.promise;
        const saved = await service.saveNotebook(notebook);
        savedA.resolve(saved);
        return saved;
      });

      await renderBook("b");
      expect(editor().getText()).toBe(nonempty ? "Existing notes for B" : "");
      expect(editor() === oldEditor).toBe(false);
      // Teardown starts persistence immediately; it must not wait for the debounce.
      expect(AnnotationService.saveNotebook).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: "a", content: pendingA }),
      );
      expect(context.notebookEditorCallbackMap.current.has("a")).toBe(false);
      expect(context.notebookEditorCallbackMap.current.has("b")).toBe(true);
      saveGate.resolve();
      await act(async () => {
        await savedA.promise;
      });
      await settle(async () => {
        expect((await service.getNotebook("a"))?.content).toEqual(pendingA);
        expect(await service.getNotebook("b")).toEqual(beforeB);
      });

      const pendingB = await edit(" Only B edit");
      await act(async () => {
        root.unmount();
      });
      await settle(async () => {
        expect((await service.getNotebook("a"))?.content).toEqual(pendingA);
        expect((await service.getNotebook("b"))?.content).toEqual(pendingB);
      });
      expect(JSON.stringify(pendingB)).not.toContain("Private notes for A");
    },
  );

  it.each([false, true])(
    "leaves B blank while its first hydration is pending (nonempty: %s)",
    async (nonempty) => {
      await seed("a", "Book A");
      if (nonempty) await seed("b", "Loaded B");
      await hydrate("a");
      await renderBook("a");
      const pendingA = await edit(" edited A");
      const loadGate = deferred<void>();
      vi.mocked(AnnotationService.getNotebook).mockImplementation(async (bookId) => {
        if (bookId === "b") await loadGate.promise;
        return service.getNotebook(bookId);
      });

      await renderBook("b");
      expect(container.querySelector(".tiptap")).toBeNull();
      expect(context.notebookEditorCallbackMap.current.has("b")).toBe(false);
      await settle(async () => {
        expect((await service.getNotebook("a"))?.content).toEqual(pendingA);
      });
      loadGate.resolve();
      await settle(() => {
        expect(editor().getText()).toBe(nonempty ? "Loaded B" : "");
      });
      expect((await service.getNotebook("b"))?.content ?? null).toEqual(
        nonempty ? documentWith("Loaded B") : null,
      );
    },
  );

  it.each([false, true])(
    "preserves a same-book editor and remote updates (initially empty: %s)",
    async (empty) => {
      if (!empty) await seed("a", "Initial A");
      await hydrate("a");
      await renderBook("a");
      const sameEditor = editor();
      await renderBook("a");
      expect(editor()).toBe(sameEditor);
      await syncNotebook("a", documentWith("Remote A"));
      await settle(() => {
        expect(
          store.annotationsSelectors.selectNotebookByBookId.select(store.state, "a")?.content,
        ).toEqual(documentWith("Remote A"));
        expect(editor().getText()).toBe("Remote A");
      });
      await act(async () => {
        root.unmount();
      });
      expect(AnnotationService.saveNotebook).not.toHaveBeenCalled();
    },
  );

  it("keeps newer callback registrations when an older editor unmounts", async () => {
    await seed("a", "Book A");
    await hydrate("a");
    await act(async () => {
      root.render(
        <>
          <WorkspaceNotebookPanel key="old" bookId="a" bookTitle="A" chromeless />
          <WorkspaceNotebookPanel key="new" bookId="a" bookTitle="A" chromeless />
        </>,
      );
    });
    const latestEditorCallbacks = context.notebookEditorCallbackMap.current.get("a");
    const latestAppend = context.notebookCallbackMap.current.get("a");
    await act(async () => {
      root.render(
        <>
          <WorkspaceNotebookPanel key="new" bookId="a" bookTitle="A" chromeless />
        </>,
      );
    });
    expect(context.notebookEditorCallbackMap.current.get("a")).toBe(latestEditorCallbacks);
    expect(context.notebookCallbackMap.current.get("a")).toBe(latestAppend);
  });

  it("does not save untouched B when switching and closing the notebook", async () => {
    await seed("a", "Book A");
    await hydrate("a");
    await hydrate("b");
    await renderBook("a");
    const pendingA = await edit(" Edited A");
    await renderBook("b");
    await act(async () => {
      root.unmount();
    });
    await settle(async () => {
      expect((await service.getNotebook("a"))?.content).toEqual(pendingA);
      expect(await service.getNotebook("b")).toBeNull();
    });
    expect(
      vi.mocked(AnnotationService.saveNotebook).mock.calls.map(([notebook]) => notebook.bookId),
    ).toEqual(["a"]);
  });

  it("keeps newer edits when an in-flight A save finishes after the switch", async () => {
    await seed("a", "Book A");
    await seed("b", "Book B");
    await hydrate("a");
    await hydrate("b");
    await renderBook("a");
    const gate = deferred<void>();
    const olderFinished = deferred<void>();
    vi.mocked(AnnotationService.saveNotebook).mockImplementationOnce(async (notebook) => {
      await gate.promise;
      const saved = await service.saveNotebook(notebook);
      olderFinished.resolve();
      return saved;
    });
    await edit(" Older A");
    await settle(() => {
      expect(AnnotationService.saveNotebook).toHaveBeenCalledTimes(1);
    });
    const latestA = await edit(" Newer A");
    await renderBook("b");
    expect(editor().getText()).toBe("Book B");
    const latestB = await edit(" Newer B");
    await settle(async () => {
      expect((await service.getNotebook("a"))?.content).toEqual(latestA);
    });
    await act(async () => {
      gate.resolve();
      await olderFinished.promise;
    });
    expect(editor().getJSON()).toEqual(latestB);
    await act(async () => {
      root.unmount();
    });
    await settle(async () => {
      expect((await service.getNotebook("a"))?.content).toEqual(latestA);
      expect((await service.getNotebook("b"))?.content).toEqual(latestB);
      expect(
        store.annotationsSelectors.selectNotebookByBookId.select(store.state, "a")?.content,
      ).toEqual(latestA);
    });
  });

  it("appends and navigates B highlights while ignoring callbacks retained from A", async () => {
    await seed("a", "Book A");
    await hydrate("a");
    await hydrate("b");
    await renderBook("a");
    const oldCallbacks = context.notebookEditorCallbackMap.current.get("a")!;
    const oldAppend = context.notebookCallbackMap.current.get("a")!;
    await renderBook("b");
    const attrs = { highlightId: "h-b", cfiRange: "epubcfi(/6/4)", text: "Passage B" };
    await act(async () => {
      oldCallbacks.appendContent(documentWith("Late A").content!);
      oldCallbacks.setContent(documentWith("Late A"));
      oldCallbacks.seedLastContent(documentWith("Late A"));
      oldAppend({ ...attrs, text: "Late A" });
      context.notebookCallbackMap.current.get("b")!(attrs);
    });
    expect(editor().getText()).not.toContain("Late A");
    expect(editor().getJSON().content).toContainEqual({ type: "highlightReference", attrs });
    await act(async () => {
      await new Promise<void>((resolve) =>
        queueMicrotask(() => {
          container.querySelector<HTMLElement>("blockquote")!.click();
          resolve();
        }),
      );
    });
    expect(context.navigateInCluster).toHaveBeenCalledWith("b", attrs.cfiRange);
    const expectedB = editor().getJSON();
    await act(async () => {
      root.unmount();
    });
    await settle(async () => {
      expect((await service.getNotebook("b"))?.content).toEqual(expectedB);
    });
    expect((await service.getNotebook("a"))?.content).toEqual(documentWith("Book A"));
  });

  it("ignores older completion bookkeeping after a newer save", async () => {
    await seed("a", "Book A");
    await hydrate("a");
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, "dispatch", { value: dispatch });
    await renderBook("a");
    const oldContent = await edit(" Older edit");
    const oldAction = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === updateNotebookRequested.type)
      .at(-1) as ReturnType<typeof updateNotebookRequested>;
    const latestContent = await edit(" Newer edit");
    await settle(async () => {
      expect((await service.getNotebook("a"))?.content).toEqual(latestContent);
    });
    await act(async () => {
      oldAction.payload[3]?.({ bookId: "a", content: oldContent, updatedAt: 2 });
    });
    // A later authoritative snapshot may legitimately restore earlier content.
    // A stale completion must not make reconciliation mistake it for a no-op.
    await syncNotebook("a", oldContent);
    await settle(() => {
      expect(editor().getJSON()).toEqual(oldContent);
    });
  });

  it("ignores old save callbacks after newer edits and editor replacement", async () => {
    await seed("a", "Book A");
    await seed("b", "Book B");
    await hydrate("a");
    await hydrate("b");
    const dispatch = vi.fn(store.dispatch);
    Object.defineProperty(store, "dispatch", { value: dispatch });
    await renderBook("a");
    await settle(() => {
      expect(container.querySelector(".tiptap")).not.toBeNull();
    });
    const oldContent = await edit(" Older A edit");
    const oldAction = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === updateNotebookRequested.type)
      .at(-1) as ReturnType<typeof updateNotebookRequested>;
    const latestA = await edit(" Newer A edit");
    // Explicitly replay a late callback in addition to exercising the real saga.
    await act(async () => {
      oldAction.payload[3]?.({ bookId: "a", content: oldContent, updatedAt: 2 });
    });
    await renderBook("b");
    expect(editor().getText()).toBe("Book B");
    const latestB = await edit(" Newer B edit");
    await act(async () => {
      oldAction.payload[3]?.({ bookId: "a", content: oldContent, updatedAt: 2 });
    });
    await act(async () => {
      root.unmount();
    });
    await settle(async () => {
      expect((await service.getNotebook("a"))?.content).toEqual(latestA);
      expect((await service.getNotebook("b"))?.content).toEqual(latestB);
    });
  });
});
