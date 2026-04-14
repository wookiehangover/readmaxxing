import { type JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { HighlightReference } from "./tiptap-highlight-node";
import { tiptapJsonToMarkdown } from "./tiptap-to-markdown";
import { markdownToTiptapJson } from "./markdown-to-tiptap";

export type BlockType =
  | "heading"
  | "paragraph"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "highlightReference"
  | "horizontalRule"
  | "listItem";

export interface Block {
  type: BlockType;
  text: string;
  level?: number;
  index: number;
  attrs?: Record<string, unknown>;
  /** For listItem blocks, the index of the parent list block */
  parentIndex?: number;
  /** Nesting depth for listItem blocks (0 = top-level, 1 = first sub-level, etc.) */
  depth?: number;
  /** @internal ProseMirror position of this block's start */
  _pos: number;
  /** @internal Index into doc.content (top-level nodes only) */
  _topLevelIndex?: number;
  /** @internal For listItem blocks: parent list's index in doc.content */
  _parentTopLevelIndex?: number;
  /** @internal For listItem blocks: index within the parent list's content array */
  _listItemChildIndex?: number;
  /** @internal JSON path from top-level list down to the parent list containing this item.
   *  Empty for depth-0 items. Pairs of [listItemIdx, nestedListContentIdx] for each nesting level. */
  _jsonPath?: number[];
  /** @internal Mutation generation when this block was created */
  _generation?: number;
}

export interface NotebookSDK {
  getMarkdown(): string;
  getBlocks(): Block[];
  find(query: string | { type?: BlockType; text?: string | RegExp }): Block[];

  append(markdown: string): void;
  prepend(markdown: string): void;
  replace(block: Block, markdown: string): boolean;
  remove(block: Block): boolean;
  insertAfter(block: Block, markdown: string): void;
  insertBefore(block: Block, markdown: string): void;

  setContent(markdown: string): void;
}

function getTextFromNode(node: any): string {
  if (node.isText) return node.text ?? "";
  const parts: string[] = [];
  node.forEach((child: any) => {
    parts.push(getTextFromNode(child));
  });
  return parts.join("\n");
}

/** Get only the direct paragraph/text content of a listItem, excluding nested lists */
function getDirectTextFromListItem(node: any): string {
  const parts: string[] = [];
  node.forEach((child: any) => {
    if (child.type.name !== "bulletList" && child.type.name !== "orderedList") {
      parts.push(getTextFromNode(child));
    }
  });
  return parts.join("\n");
}

/**
 * Recursively extract listItem blocks from a list node, handling arbitrary nesting.
 * @param pathToList - pairs of [listItemIdx, nestedListContentIdx] describing
 *   the navigation from the top-level list to the current list node.
 */
function extractListItems(
  listNode: any,
  blocks: Block[],
  indexRef: { value: number },
  parentIndex: number,
  parentTopLevelIndex: number,
  depth: number,
  pathToList: number[],
  generation: number,
): void {
  let childIdx = 0;
  listNode.forEach((listItemNode: any) => {
    const directText = getDirectTextFromListItem(listItemNode);

    blocks.push({
      type: "listItem",
      text: directText,
      index: indexRef.value,
      depth,
      parentIndex,
      _pos: 0,
      _parentTopLevelIndex: parentTopLevelIndex,
      _listItemChildIndex: childIdx,
      _jsonPath: [...pathToList],
      _generation: generation,
    });

    const thisItemIndex = indexRef.value;
    indexRef.value++;

    // Recurse into nested lists within this listItem
    listItemNode.forEach((child: any, _offset: number, contentIdx: number) => {
      if (child.type.name === "bulletList" || child.type.name === "orderedList") {
        extractListItems(
          child,
          blocks,
          indexRef,
          thisItemIndex,
          parentTopLevelIndex,
          depth + 1,
          [...pathToList, childIdx, contentIdx],
          generation,
        );
      }
    });

    childIdx++;
  });
}

function extractBlocks(editor: Editor, generation: number): Block[] {
  const blocks: Block[] = [];
  const indexRef = { value: 0 };
  let topLevelIndex = 0;
  editor.state.doc.forEach((node, offset) => {
    const block: Block = {
      type: node.type.name as BlockType,
      text: getTextFromNode(node),
      index: indexRef.value,
      _pos: offset + 1, // +1 because doc node wraps content
      _topLevelIndex: topLevelIndex,
      _generation: generation,
    };
    if (node.type.name === "heading") {
      block.level = node.attrs.level;
    }
    if (node.attrs && Object.keys(node.attrs).length > 0) {
      block.attrs = { ...node.attrs };
    }
    blocks.push(block);
    const parentIndex = indexRef.value;
    const parentTopLevelIndex = topLevelIndex;
    indexRef.value++;
    topLevelIndex++;

    // Emit child listItem blocks for bullet/ordered lists (recursive)
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      extractListItems(node, blocks, indexRef, parentIndex, parentTopLevelIndex, 0, [], generation);
    }
  });
  return blocks;
}

/**
 * Navigate through the JSON tree to find and clone the path to a nested listItem's parent list.
 * Returns cloned doc content array and a reference to the (cloned) parent list node.
 */
function navigateToListItem(
  docJson: JSONContent,
  block: Block,
): { newContent: JSONContent[]; parentList: JSONContent } | null {
  const topIdx = block._parentTopLevelIndex;
  const path = block._jsonPath ?? [];

  if (topIdx === undefined || !docJson.content) return null;
  if (topIdx < 0 || topIdx >= docJson.content.length) return null;

  const newContent: JSONContent[] = [...docJson.content];

  // Clone the top-level list
  let currentList: JSONContent = {
    ...newContent[topIdx],
    content: [...(newContent[topIdx].content ?? [])],
  };
  newContent[topIdx] = currentList;

  // Navigate through path pairs [listItemIdx, nestedListContentIdx, ...]
  for (let i = 0; i < path.length; i += 2) {
    const liIdx = path[i];
    const nestedListContentIdx = path[i + 1];

    if (!currentList.content || liIdx >= currentList.content.length) return null;

    // Clone the listItem
    const clonedLi: JSONContent = {
      ...currentList.content[liIdx],
      content: [...(currentList.content[liIdx].content ?? [])],
    };
    currentList.content[liIdx] = clonedLi;

    const liContent = clonedLi.content!;
    if (nestedListContentIdx >= liContent.length) return null;

    // Clone the nested list
    const clonedNestedList: JSONContent = {
      ...liContent[nestedListContentIdx],
      content: [...(liContent[nestedListContentIdx].content ?? [])],
    };
    liContent[nestedListContentIdx] = clonedNestedList;
    currentList = clonedNestedList;
  }

  return { newContent, parentList: currentList };
}

/**
 * Remove an empty nested list from its parent listItem after the last item was removed.
 */
function removeEmptyNestedList(newContent: JSONContent[], block: Block): void {
  const path = block._jsonPath ?? [];
  if (path.length === 0) {
    // Top-level list is empty, remove from doc
    newContent.splice(block._parentTopLevelIndex!, 1);
  } else {
    // Navigate through already-cloned newContent to find the parent listItem
    let container = newContent[block._parentTopLevelIndex!];
    for (let i = 0; i < path.length - 2; i += 2) {
      container = container.content![path[i]].content![path[i + 1]];
    }
    const parentLiIdx = path[path.length - 2];
    const nestedListContentIdx = path[path.length - 1];
    container.content![parentLiIdx].content!.splice(nestedListContentIdx, 1);
  }
}

function parseMarkdownNodes(_editor: Editor, markdown: string): JSONContent[] {
  // Create fresh extension instances to avoid duplicate keyed plugin errors
  const tempEditor = new Editor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: markdown,
  });
  const nodes = tempEditor.getJSON().content ?? [];
  tempEditor.destroy();
  return nodes;
}

export function createNotebookSDK(content: JSONContent): {
  sdk: NotebookSDK;
  getResult: () => JSONContent;
  destroy: () => void;
} {
  // For headless usage, override the node view so it doesn't require a React component
  const HeadlessHighlightReference = HighlightReference.extend({
    addNodeView() {
      return () => {
        const dom = document.createElement("div");
        dom.setAttribute("data-highlight-reference", "");
        return { dom };
      };
    },
  });

  const editor = new Editor({
    extensions: [StarterKit, Markdown.configure({ html: false }), HeadlessHighlightReference],
    content,
  });

  let mutationGeneration = 0;

  /**
   * Resolve a block to its current position. If the block is stale (from a
   * previous mutation generation), re-find it by text match and warn.
   */
  function resolveBlock(block: Block): Block | null {
    if (block._generation !== undefined && block._generation !== mutationGeneration) {
      console.warn(
        `notebook: block "${block.text}" is stale (gen ${block._generation} vs ${mutationGeneration}). Re-finding by text.`,
      );
      const blocks = extractBlocks(editor, mutationGeneration);
      const found = blocks.find((b) => b.type === block.type && b.text === block.text);
      if (!found) {
        console.warn(`notebook: could not re-find stale block "${block.text}"`);
        return null;
      }
      return found;
    }
    return block;
  }

  const sdk: NotebookSDK = {
    getMarkdown(): string {
      return tiptapJsonToMarkdown(editor.getJSON());
    },

    getBlocks(): Block[] {
      return extractBlocks(editor, mutationGeneration);
    },

    find(query: string | { type?: BlockType; text?: string | RegExp }): Block[] {
      const blocks = extractBlocks(editor, mutationGeneration);
      let results: Block[];
      if (typeof query === "string") {
        results = blocks.filter((b) => b.text.includes(query));
      } else {
        results = blocks.filter((b) => {
          if (query.type && b.type !== query.type) return false;
          if (query.text !== undefined) {
            if (typeof query.text === "string") {
              return b.text.includes(query.text);
            }
            return query.text.test(b.text);
          }
          return true;
        });
      }
      if (results.length === 0) {
        console.warn(`notebook.find(): no blocks matched query`, query);
      }
      return results;
    },

    append(markdown: string): void {
      const nodes = parseMarkdownNodes(editor, markdown);
      const endPos = editor.state.doc.content.size;
      editor.commands.insertContentAt(endPos, nodes);
      mutationGeneration++;
    },

    prepend(markdown: string): void {
      const nodes = parseMarkdownNodes(editor, markdown);
      editor.commands.insertContentAt(1, nodes);
      mutationGeneration++;
    },

    replace(block: Block, markdown: string): boolean {
      const resolved = resolveBlock(block);
      if (!resolved) return false;

      const docJson = editor.getJSON();
      if (!docJson.content) return false;

      if (resolved.type === "listItem") {
        // JSON-splice: replace the listItem within its parent list (supports nesting)
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return false;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return false;
        const { newContent, parentList } = nav;

        if (!parentList.content || childIdx < 0 || childIdx >= parentList.content.length)
          return false;

        // Parse replacement and wrap in listItem
        const parsed = parseMarkdownNodes(editor, markdown);
        const listItemContent =
          parsed.length > 0
            ? parsed
            : [{ type: "paragraph", content: [{ type: "text", text: markdown }] }];
        const listItemNode: JSONContent = { type: "listItem", content: listItemContent };

        parentList.content.splice(childIdx, 1, listItemNode);
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return true;
      }

      // Top-level block: use _topLevelIndex
      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return false;
      const parsed = parseMarkdownNodes(editor, markdown);
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 1, ...parsed);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
      return true;
    },

    remove(block: Block): boolean {
      const resolved = resolveBlock(block);
      if (!resolved) return false;

      const docJson = editor.getJSON();
      if (!docJson.content) return false;

      if (resolved.type === "listItem") {
        // JSON-splice: remove the listItem from its parent list (supports nesting)
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return false;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return false;
        const { newContent, parentList } = nav;

        if (!parentList.content || childIdx < 0 || childIdx >= parentList.content.length)
          return false;

        parentList.content.splice(childIdx, 1);

        if (parentList.content.length === 0) {
          // If list is now empty, remove it from its parent
          removeEmptyNestedList(newContent, resolved);
        }
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return true;
      }

      // Top-level block: use _topLevelIndex
      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return false;
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 1);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
      return true;
    },

    insertAfter(block: Block, markdown: string): void {
      const resolved = resolveBlock(block);
      if (!resolved) return;

      const docJson = editor.getJSON();
      if (!docJson.content) return;
      const parsed = parseMarkdownNodes(editor, markdown);

      if (resolved.type === "listItem") {
        // Insert after this listItem within the parent list (supports nesting)
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return;
        const { newContent, parentList } = nav;
        if (!parentList.content) return;

        // Wrap parsed nodes as listItem(s)
        const newListItems = parsed.map((node) => {
          if (node.type === "listItem") return node;
          return { type: "listItem", content: [node] } as JSONContent;
        });
        parentList.content.splice(childIdx + 1, 0, ...newListItems);
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return;
      }

      // Top-level: insert after _topLevelIndex
      const idx = resolved._topLevelIndex;
      if (idx === undefined) return;
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx + 1, 0, ...parsed);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
    },

    insertBefore(block: Block, markdown: string): void {
      const resolved = resolveBlock(block);
      if (!resolved) return;

      const docJson = editor.getJSON();
      if (!docJson.content) return;
      const parsed = parseMarkdownNodes(editor, markdown);

      if (resolved.type === "listItem") {
        // Insert before this listItem within the parent list (supports nesting)
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return;
        const { newContent, parentList } = nav;
        if (!parentList.content) return;

        const newListItems = parsed.map((node) => {
          if (node.type === "listItem") return node;
          return { type: "listItem", content: [node] } as JSONContent;
        });
        parentList.content.splice(childIdx, 0, ...newListItems);
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return;
      }

      // Top-level: insert before _topLevelIndex
      const idx = resolved._topLevelIndex;
      if (idx === undefined) return;
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 0, ...parsed);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
    },

    setContent(markdown: string): void {
      const parsed = markdownToTiptapJson(markdown);
      editor.commands.setContent(parsed);
      mutationGeneration++;
    },
  };

  return {
    sdk,
    getResult: () => editor.getJSON(),
    destroy: () => editor.destroy(),
  };
}
