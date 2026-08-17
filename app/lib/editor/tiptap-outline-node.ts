import { mergeAttributes, Node } from "@tiptap/react";

export const OutlineIncrement = Node.create({
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
});
