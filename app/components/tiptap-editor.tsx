import { useEditor, EditorContent, NodeViewWrapper } from "@tiptap/react";
import type { ReactNodeViewProps, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
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
}

function HighlightReferenceView({ node, extension }: ReactNodeViewProps) {
  const { text, cfiRange } = node.attrs as HighlightReferenceAttrs;
  const storage = extension.storage as HighlightReferenceStorage;

  const handleClick = () => {
    storage.onNavigateToHighlight?.(cfiRange);
  };

  return (
    <NodeViewWrapper>
      <blockquote
        onClick={handleClick}
        className="my-2 cursor-pointer rounded border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm italic text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-950/80"
        title="Click to navigate to this highlight"
      >
        "{text}"
      </blockquote>
    </NodeViewWrapper>
  );
}

export const TiptapEditor = forwardRef<TiptapEditorHandle, TiptapEditorProps>(function TiptapEditor(
  { content, onUpdate, onNavigateToHighlight },
  ref,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const editor = useEditor({
    extensions: [
      StarterKit,
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

  // Keep the navigate callback in extension storage so HighlightReferenceView can access it
  useEffect(() => {
    if (!editor) return;
    const storage = editor.extensionManager.extensions.find(
      (ext) => ext.name === "highlightReference",
    )?.storage as HighlightReferenceStorage | undefined;
    if (storage) {
      storage.onNavigateToHighlight = onNavigateToHighlight ?? null;
    }
  }, [editor, onNavigateToHighlight]);

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
