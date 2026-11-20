import { type JSONContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { HighlightReference } from "./tiptap-highlight-node";
import { tiptapJsonToMarkdown } from "./tiptap-to-markdown";

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
  parentIndex?: number;
  depth?: number;
  _pos: number;
  _topLevelIndex?: number;
  _parentTopLevelIndex?: number;
  _listItemChildIndex?: number;
  _jsonPath?: number[];
  _generation?: number;
}

export interface NotebookSDK {
  getMarkdown(): string;
  getBlocks(): Block[];
  refresh(): Block[];
  find(query: string | { type?: BlockType; text?: string | RegExp }): Block[];

  append(markdown: string): void;
  prepend(markdown: string): void;
  replace(block: Block, markdown: string): boolean;
  setText(block: Block, text: string): boolean;
  remove(block: Block): boolean;
  move(block: Block, target: Block, position?: "before" | "after"): boolean;
  insertAfter(block: Block, markdown: string): void;
  insertBefore(block: Block, markdown: string): void;
}

function getTextFromNode(node: any): string {
  if (node.isText) return node.text ?? "";
  const parts: string[] = [];
  node.forEach((child: any) => {
    parts.push(getTextFromNode(child));
  });
  const hasBlockChildren = node.childCount > 0 && !node.firstChild?.isInline;
  return parts.join(hasBlockChildren ? "\n" : "");
}

function getDirectTextFromListItem(node: any): string {
  const parts: string[] = [];
  node.forEach((child: any) => {
    if (child.type.name !== "bulletList" && child.type.name !== "orderedList") {
      parts.push(getTextFromNode(child));
    }
  });
  return parts.join("\n");
}

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
      _pos: offset + 1,
      _topLevelIndex: topLevelIndex,
      _generation: generation,
    };
    if (node.type.name === "heading") {
      block.level = node.attrs.level;
    }
    if (node.type.name === "highlightReference") {
      block.text = node.attrs?.text ?? "";
    }
    if (node.attrs && Object.keys(node.attrs).length > 0) {
      block.attrs = { ...node.attrs };
    }
    blocks.push(block);
    const parentIndex = indexRef.value;
    const parentTopLevelIndex = topLevelIndex;
    indexRef.value++;
    topLevelIndex++;

    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      extractListItems(node, blocks, indexRef, parentIndex, parentTopLevelIndex, 0, [], generation);
    }
  });
  return blocks;
}

function navigateToListItem(
  docJson: JSONContent,
  block: Block,
): { newContent: JSONContent[]; parentList: JSONContent } | null {
  const topIdx = block._parentTopLevelIndex;
  const path = block._jsonPath ?? [];

  if (topIdx === undefined || !docJson.content) return null;
  if (topIdx < 0 || topIdx >= docJson.content.length) return null;

  const newContent: JSONContent[] = [...docJson.content];

  let currentList: JSONContent = {
    ...newContent[topIdx],
    content: [...(newContent[topIdx].content ?? [])],
  };
  newContent[topIdx] = currentList;

  for (let i = 0; i < path.length; i += 2) {
    const liIdx = path[i];
    const nestedListContentIdx = path[i + 1];

    if (!currentList.content || liIdx >= currentList.content.length) return null;

    const clonedLi: JSONContent = {
      ...currentList.content[liIdx],
      content: [...(currentList.content[liIdx].content ?? [])],
    };
    currentList.content[liIdx] = clonedLi;

    const liContent = clonedLi.content!;
    if (nestedListContentIdx >= liContent.length) return null;

    const clonedNestedList: JSONContent = {
      ...liContent[nestedListContentIdx],
      content: [...(liContent[nestedListContentIdx].content ?? [])],
    };
    liContent[nestedListContentIdx] = clonedNestedList;
    currentList = clonedNestedList;
  }

  return { newContent, parentList: currentList };
}

function removeEmptyNestedList(newContent: JSONContent[], block: Block): void {
  const path = block._jsonPath ?? [];
  if (path.length === 0) {
    newContent.splice(block._parentTopLevelIndex!, 1);
  } else {
    let container = newContent[block._parentTopLevelIndex!];
    for (let i = 0; i < path.length - 2; i += 2) {
      container = container.content![path[i]].content![path[i + 1]];
    }
    const parentLiIdx = path[path.length - 2];
    const nestedListContentIdx = path[path.length - 1];
    container.content![parentLiIdx].content!.splice(nestedListContentIdx, 1);
  }
}

function parseMarkdownNodes(
  _editor: Editor,
  markdown: string,
  parseMarkdown?: (markdown: string) => JSONContent,
): JSONContent[] {
  if (parseMarkdown) return parseMarkdown(markdown).content ?? [];

  const tempEditor = new Editor({
    extensions: [StarterKit, Markdown.configure({ html: false })],
    content: markdown,
  });
  const nodes = tempEditor.getJSON().content ?? [];
  tempEditor.destroy();
  return nodes;
}

export function createNotebookSDK(
  content: JSONContent,
  options: { parseMarkdown?: (markdown: string) => JSONContent } = {},
): {
  sdk: NotebookSDK;
  getResult: () => JSONContent;
  destroy: () => void;
} {
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
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown.configure({ html: false }),
      HeadlessHighlightReference,
    ],
    content,
  });

  let mutationGeneration = 0;

  function resolveBlock(block: Block): Block | null {
    if (block._generation !== undefined && block._generation !== mutationGeneration) {
      console.warn(
        `notebook: block "${block.text}" is stale (gen ${block._generation} vs ${mutationGeneration}). Re-finding against live blocks.`,
      );
      const blocks = extractBlocks(editor, mutationGeneration);
      const highlightId = block.attrs?.highlightId;
      const found =
        block.type === "highlightReference" && highlightId
          ? blocks.find(
              (b) => b.type === "highlightReference" && b.attrs?.highlightId === highlightId,
            )
          : blocks.find((b) => b.type === block.type && b.text === block.text);
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

    refresh(): Block[] {
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
            query.text.lastIndex = 0;
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
      const nodes = parseMarkdownNodes(editor, markdown, options.parseMarkdown);
      const endPos = editor.state.doc.content.size;
      editor.commands.insertContentAt(endPos, nodes);
      mutationGeneration++;
    },

    prepend(markdown: string): void {
      const nodes = parseMarkdownNodes(editor, markdown, options.parseMarkdown);
      editor.commands.insertContentAt(1, nodes);
      mutationGeneration++;
    },

    replace(block: Block, markdown: string): boolean {
      const resolved = resolveBlock(block);
      if (!resolved) return false;

      const docJson = editor.getJSON();
      if (!docJson.content) return false;

      if (resolved.type === "listItem") {
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return false;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return false;
        const { newContent, parentList } = nav;

        if (!parentList.content || childIdx < 0 || childIdx >= parentList.content.length)
          return false;

        const parsed = parseMarkdownNodes(editor, markdown, options.parseMarkdown);
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

      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return false;
      const parsed = parseMarkdownNodes(editor, markdown, options.parseMarkdown);
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 1, ...parsed);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
      return true;
    },

    setText(block: Block, text: string): boolean {
      const resolved = resolveBlock(block);
      if (!resolved) return false;

      if (resolved.type === "bulletList" || resolved.type === "orderedList") {
        console.warn(
          `notebook.setText(): cannot set text on a ${resolved.type}. ` +
            `Target an individual listItem instead.`,
        );
        return false;
      }

      const docJson = editor.getJSON();
      if (!docJson.content) return false;

      const textChild: JSONContent = { type: "text", text };

      if (resolved.type === "listItem") {
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return false;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return false;
        const { newContent, parentList } = nav;

        if (!parentList.content || childIdx < 0 || childIdx >= parentList.content.length)
          return false;

        const existingItem = parentList.content[childIdx];
        const existingChildren = existingItem.content ?? [];
        const newChildren: JSONContent[] = [];
        let replacedParagraph = false;
        for (const child of existingChildren) {
          if (!replacedParagraph && child.type === "paragraph") {
            newChildren.push({ type: "paragraph", content: [textChild] });
            replacedParagraph = true;
          } else {
            newChildren.push(child);
          }
        }
        if (!replacedParagraph) {
          newChildren.unshift({ type: "paragraph", content: [textChild] });
        }
        parentList.content[childIdx] = { ...existingItem, content: newChildren };
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return true;
      }

      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return false;

      const existing = docJson.content[idx];
      const newNode: JSONContent = {
        type: existing.type,
        ...(existing.attrs ? { attrs: { ...existing.attrs } } : {}),
        content: [textChild],
      };

      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 1, newNode);
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
        const childIdx = resolved._listItemChildIndex;
        if (childIdx === undefined) return false;

        const nav = navigateToListItem(docJson, resolved);
        if (!nav) return false;
        const { newContent, parentList } = nav;

        if (!parentList.content || childIdx < 0 || childIdx >= parentList.content.length)
          return false;

        parentList.content.splice(childIdx, 1);

        if (parentList.content.length === 0) {
          removeEmptyNestedList(newContent, resolved);
        }
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return true;
      }

      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return false;
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 1);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
      return true;
    },

    move(block: Block, target: Block, position: "before" | "after" = "after"): boolean {
      const resolvedBlock = resolveBlock(block);
      const resolvedTarget = resolveBlock(target);
      if (!resolvedBlock || !resolvedTarget) return false;

      if (resolvedBlock.type === "listItem" || resolvedTarget.type === "listItem") {
        console.warn(
          "notebook.move(): cannot move a listItem or use one as a target. " +
            "Move top-level blocks only.",
        );
        return false;
      }

      const docJson = editor.getJSON();
      if (!docJson.content) return false;

      const sourceIdx = resolvedBlock._topLevelIndex;
      const targetIdx = resolvedTarget._topLevelIndex;
      if (
        sourceIdx === undefined ||
        targetIdx === undefined ||
        sourceIdx < 0 ||
        sourceIdx >= docJson.content.length ||
        targetIdx < 0 ||
        targetIdx >= docJson.content.length
      )
        return false;

      if (sourceIdx === targetIdx) return true;

      const newContent: JSONContent[] = [...docJson.content];
      const [sourceNode] = newContent.splice(sourceIdx, 1);
      const adjustedTargetIdx = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
      const insertionIdx = position === "before" ? adjustedTargetIdx : adjustedTargetIdx + 1;
      newContent.splice(insertionIdx, 0, sourceNode);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
      return true;
    },

    insertAfter(block: Block, markdown: string): void {
      const resolved = resolveBlock(block);
      if (!resolved) return;

      const docJson = editor.getJSON();
      if (!docJson.content) return;
      const parsed = parseMarkdownNodes(editor, markdown, options.parseMarkdown);

      if (resolved.type === "listItem") {
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
        parentList.content.splice(childIdx + 1, 0, ...newListItems);
        editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
        mutationGeneration++;
        return;
      }

      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return;
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
      const parsed = parseMarkdownNodes(editor, markdown, options.parseMarkdown);

      if (resolved.type === "listItem") {
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

      const idx = resolved._topLevelIndex;
      if (idx === undefined || idx < 0 || idx >= docJson.content.length) return;
      const newContent: JSONContent[] = [...docJson.content];
      newContent.splice(idx, 0, ...parsed);
      editor.commands.setContent({ type: "doc", content: newContent } as JSONContent);
      mutationGeneration++;
    },
  };

  return {
    sdk,
    getResult: () => editor.getJSON(),
    destroy: () => editor.destroy(),
  };
}
