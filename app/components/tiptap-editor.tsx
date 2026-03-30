import { useEditor, EditorContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Navigation, Trash2 } from "lucide-react";
import {
  HighlightReference,
  type HighlightReferenceAttrs,
  type HighlightReferenceStorage,
} from "~/lib/tiptap-highlight-node";

export interface TiptapEditorHandle {
  appendHighlightReference: (attrs: HighlightReferenceAttrs) => void;
}

interface TiptapEditorProps {
  content?: JSONContent;
  onUpdate?: (content: JSONContent) => void;
  onNavigateToHighlight?: (cfi: string) => void;
  onDeleteHighlight?: (highlightId: string, cfiRange: string) => void;
}

function HighlightReferenceView({ node, extension, deleteNode }: ReactNodeViewProps) {
  const { text, cfiRange, highlightId } = node.attrs as HighlightReferenceAttrs;
  const storage = extension.storage as HighlightReferenceStorage;

  const handleNavigate = (e: React.MouseEvent) => {
    e.stopPropagation();
    storage.onNavigateToHighlight?.(cfiRange);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    storage.onDeleteHighlight?.(highlightId, cfiRange);
    deleteNode();
  };

  return (
    <NodeViewWrapper>
      <blockquote
        onClick={handleNavigate}
        className="group/hl relative my-2 cursor-pointer rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 pr-16 text-sm italic text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-950/80"
        title="Click to navigate to this highlight"
      >
        "{text}"
        <span className="absolute top-1/2 right-2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity group-hover/hl:opacity-100">
          <button
            type="button"
            onClick={handleNavigate}
            className="rounded p-1 text-amber-700 hover:bg-amber-200 dark:text-amber-300 dark:hover:bg-amber-800"
            title="Navigate to highlight"
          >
            <Navigation className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded p-1 text-amber-700 hover:bg-red-100 hover:text-red-600 dark:text-amber-300 dark:hover:bg-red-900 dark:hover:text-red-400"
            title="Delete highlight"
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </blockquote>
    </NodeViewWrapper>
  );
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
  { content, onUpdate, onNavigateToHighlight, onDeleteHighlight },
  ref,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

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
    ],
    content: content || {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    onUpdate: ({ editor }) => {
      onUpdateRef.current?.(editor.getJSON());
    },
    immediatelyRender: true,
  });

  // Keep callbacks in extension storage so HighlightReferenceView can access them
  useEffect(() => {
    if (!editor) return;
    const storage = editor.extensionManager.extensions.find(
      (ext) => ext.name === "highlightReference",
    )?.storage as HighlightReferenceStorage | undefined;
    if (storage) {
      storage.onNavigateToHighlight = onNavigateToHighlight ?? null;
      storage.onDeleteHighlight = onDeleteHighlight ?? null;
    }
  }, [editor, onNavigateToHighlight, onDeleteHighlight]);

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
    }),
    [editor],
  );

  return (
    <div className="tiptap-editor">
      <EditorContent
        editor={editor}
        className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 focus:outline-none [&_.tiptap]:min-h-[200px] [&_.tiptap]:outline-none"
      />
    </div>
  );
});
