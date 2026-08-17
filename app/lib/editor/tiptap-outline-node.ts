import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import type { ComponentType } from "react";

export interface OutlineIncrementAttrs {
  locator: string | null;
  page: string | null;
}

export const OutlineIncrement = Node.create<{ component: ComponentType<any> }>({
  name: "outlineIncrement",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      locator: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-locator"),
        renderHTML: (attributes) =>
          attributes.locator == null ? {} : { "data-locator": String(attributes.locator) },
      },
      page: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page"),
        renderHTML: (attributes) =>
          attributes.page == null ? {} : { "data-page": String(attributes.page) },
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-outline-increment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-outline-increment": "" }), 0];
  },

  addNodeView() {
    const component = this.options.component as ComponentType<any>;
    if (!component) return null;
    return ReactNodeViewRenderer(component, {
      stopEvent: ({ event }) =>
        event.type === "click" || event.type === "mousedown" || event.type === "mouseup",
    });
  },
});
