import { useEditor, EditorContent, NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useCallback, useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { Navigation, Trash2 } from "lucide-react";
import {
  HighlightReference,
  type HighlightReferenceAttrs,
} from "~/lib/editor/tiptap-highlight-node";
import { OutlineIncrement, type OutlineIncrementAttrs } from "~/lib/editor/tiptap-outline-node";
import { cn } from "~/lib/utils";

export type TiptapEditorContent = JSONContent | string;

export interface TiptapEditorHandle {
  appendHighlightReference: (attrs: HighlightReferenceAttrs) => void;
  appendContent: (nodes: JSONContent[]) => void;
  setContent: (content: TiptapEditorContent) => void;
  getContent: () => JSONContent;
  /** Returns the current number of top-level nodes in the document. */
  getTopLevelNodeCount: () => number;
  /**
   * Replace content from a given top-level node index to end of document.
   * Used for streaming preview: truncate to `fromIndex` then append `nodes`.
   */
  replaceContentFrom: (fromIndex: number, nodes: JSONContent[]) => void;
}

interface TiptapEditorProps {
  content?: TiptapEditorContent;
  compact?: boolean;
  placeholder?: string;
  onUpdate?: (content: JSONContent) => void;
  onBlur?: () => void;
  onNavigateToHighlight?: (cfi: string) => void | Promise<void>;
  onNavigateToOutlineIncrement?: (locator: string) => void | Promise<void>;
  onDeleteHighlight?: (highlightId: string, cfiRange: string) => void;
  /** Fires once the underlying Tiptap editor instance is created and ready. */
  onReady?: () => void;
}

function OutlineIncrementView({ node, editor }: ReactNodeViewProps) {
  const { locator, page } = node.attrs as OutlineIncrementAttrs;

  const handleNavigate = useCallback(() => {
    if (!locator) return;
    editor.view.dom.dispatchEvent(
      new CustomEvent("outline-increment-navigate", {
        detail: { locator },
        bubbles: true,
      }),
    );
  }, [editor, locator]);

  return (
    <NodeViewWrapper className="relative my-2 pl-7">
      {locator && page ? (
        <button
          type="button"
          contentEditable={false}
          onClick={handleNavigate}
          className="absolute top-0 left-0 w-6 cursor-pointer rounded-sm py-0.5 text-left text-xs font-normal text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Go to page ${page}`}
          title={`Go to page ${page}`}
        >
          {page}
        </button>
      ) : null}
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

function HighlightReferenceView({ node, editor, deleteNode }: ReactNodeViewProps) {
  const { text, cfiRange, highlightId } = node.attrs as HighlightReferenceAttrs;

  const handleNavigate = useCallback(() => {
    editor.view.dom.dispatchEvent(
      new CustomEvent("highlight-navigate", {
        detail: { cfi: cfiRange },
        bubbles: true,
      }),
    );
  }, [cfiRange, editor]);

  const handleDelete = useCallback(() => {
    editor.view.dom.dispatchEvent(
      new CustomEvent("highlight-delete", {
        detail: { highlightId, cfiRange },
        bubbles: true,
      }),
    );
    deleteNode();
  }, [highlightId, cfiRange, editor, deleteNode]);

  return (
    <NodeViewWrapper className="group/hl relative my-2">
      <blockquote
        onClick={handleNavigate}
        className="my-0 cursor-pointer border-0 bg-foreground/[0.04] px-3 py-2 text-sm italic text-muted-foreground transition-colors hover:bg-muted/70"
        title="Click to navigate to this highlight"
      >
        "{text}"
      </blockquote>
      <div className="absolute top-full right-1 z-10 mt-0.5 flex gap-0.5 opacity-0 transition-opacity group-hover/hl:opacity-100 group-focus-within/hl:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleNavigate();
          }}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Navigate to highlight"
        >
          <Navigation className="size-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Delete highlight"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
  {
    content,
    compact = false,
    placeholder,
    onUpdate,
    onBlur,
    onNavigateToHighlight,
    onNavigateToOutlineIncrement,
    onDeleteHighlight,
    onReady,
  },
  ref,
) {
  const [isEmpty, setIsEmpty] = useState(true);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: false,
      }),
      HighlightReference.configure({
        component: HighlightReferenceView,
      }),
      OutlineIncrement.configure({
        component: OutlineIncrementView,
      }),
    ],
    content: content || {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    onCreate: ({ editor }) => setIsEmpty(editor.isEmpty),
    onTransaction: ({ editor }) => setIsEmpty(editor.isEmpty),
    onUpdate: ({ editor }) => {
      onUpdateRef.current?.(editor.getJSON());
    },
    onBlur: () => {
      onBlurRef.current?.();
    },
    immediatelyRender: true,
  });

  // Notify parent when editor becomes available
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const firedReadyRef = useRef(false);
  useEffect(() => {
    if (editor && !firedReadyRef.current) {
      firedReadyRef.current = true;
      onReadyRef.current?.();
    }
  }, [editor]);

  // Listen for custom DOM events dispatched by HighlightReferenceView
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const handleNavigate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onNavigateToHighlight?.(detail.cfi);
    };

    const handleDelete = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onDeleteHighlight?.(detail.highlightId, detail.cfiRange);
    };

    const handleOutlineNavigate = (e: Event) => {
      const detail = (e as CustomEvent<{ locator?: unknown }>).detail;
      if (typeof detail?.locator === "string") {
        void onNavigateToOutlineIncrement?.(detail.locator);
      }
    };

    dom.addEventListener("highlight-navigate", handleNavigate);
    dom.addEventListener("highlight-delete", handleDelete);
    dom.addEventListener("outline-increment-navigate", handleOutlineNavigate);
    return () => {
      dom.removeEventListener("highlight-navigate", handleNavigate);
      dom.removeEventListener("highlight-delete", handleDelete);
      dom.removeEventListener("outline-increment-navigate", handleOutlineNavigate);
    };
  }, [editor, onNavigateToHighlight, onNavigateToOutlineIncrement, onDeleteHighlight]);

  // Expose imperative handle for appending highlight references
  useImperativeHandle(
    ref,
    () => ({
      appendHighlightReference(attrs: HighlightReferenceAttrs) {
        if (!editor) return;
        const nodes: JSONContent[] = [{ type: "highlightReference", attrs }, { type: "paragraph" }];
        const endPos = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(endPos, nodes).run();
      },
      appendContent(nodes: JSONContent[]) {
        if (!editor) return;
        const endPos = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(endPos, nodes).run();
      },
      setContent(content: TiptapEditorContent) {
        if (!editor) return;
        // Programmatic content always comes from an authoritative server/sync
        // snapshot. Do not emit onUpdate, which would enqueue a newer local
        // autosave and could overwrite a subsequent remote change.
        editor.commands.setContent(content, { emitUpdate: false });
      },
      getContent() {
        if (!editor) return { type: "doc", content: [] };
        return editor.getJSON();
      },
      getTopLevelNodeCount() {
        if (!editor) return 0;
        return editor.state.doc.childCount;
      },
      replaceContentFrom(fromIndex: number, nodes: JSONContent[]) {
        if (!editor) return;
        const doc = editor.state.doc;
        // Find the position at the start of the node at fromIndex
        let pos = 0;
        for (let i = 0; i < Math.min(fromIndex, doc.childCount); i++) {
          pos += doc.child(i).nodeSize;
        }
        // Delete from pos to end, then insert new nodes
        const endPos = doc.content.size;
        editor.chain().deleteRange({ from: pos, to: endPos }).insertContentAt(pos, nodes).run();
      },
    }),
    [editor],
  );

  return (
    <div className="tiptap-editor relative">
      {placeholder && isEmpty ? (
        <p
          aria-hidden="true"
          className={cn("pointer-events-none absolute top-0 left-0 z-10 text-sm", {
            "px-4 py-3": !compact,
            "text-muted-foreground": !compact,
            "text-muted-foreground/35": compact,
          })}
        >
          {placeholder}
        </p>
      ) : null}
      <EditorContent
        editor={editor}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none [&_.tiptap]:min-h-[200px] [&_.tiptap]:outline-none [&_.tiptap_li]:my-0.5 [&_.tiptap_li_p]:my-0 [&_h1]:text-[1.125em] [&_h1]:font-medium [&_h2]:text-[1em] [&_h2]:font-medium [&_h3]:text-[0.9375em] [&_h4]:text-[0.875em] [&_h5]:text-[0.8125em] [&_h6]:text-[0.75em]",
          { "px-4 py-3": !compact },
        )}
      />
    </div>
  );
});
