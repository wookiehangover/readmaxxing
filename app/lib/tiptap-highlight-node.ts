import { Node, mergeAttributes } from "@tiptap/react";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { ComponentType } from "react";

export interface HighlightReferenceAttrs {
  highlightId: string;
  cfiRange: string;
  text: string;
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    highlightReference: {
      insertHighlightReference: (attrs: HighlightReferenceAttrs) => ReturnType;
    };
  }
}

export interface HighlightReferenceStorage {
  onNavigateToHighlight: ((cfi: string) => void) | null;
}

export const HighlightReference = Node.create<
  { component: ComponentType<any> },
  HighlightReferenceStorage
>({
  name: "highlightReference",
  group: "block",
  atom: true,

  addStorage() {
    return {
      onNavigateToHighlight: null,
    };
  },

  addAttributes() {
    return {
      highlightId: { default: null },
      cfiRange: { default: null },
      text: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-highlight-reference]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-highlight-reference": "" }), 0];
  },

  addCommands() {
    return {
      insertHighlightReference:
        (attrs: HighlightReferenceAttrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },

  addNodeView() {
    // The component is set via extension options to avoid circular imports
    const component = this.options.component as ComponentType<any>;
    if (!component) {
      throw new Error("HighlightReference: component option is required");
    }
    return ReactNodeViewRenderer(component);
  },
});
