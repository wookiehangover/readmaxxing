import type { JSONContent } from "@tiptap/react";

/**
 * Converts a tiptap JSONContent document to a markdown string.
 * Handles: headings, paragraphs, bullet/ordered lists, blockquotes,
 * bold/italic/code marks, and custom highlightReference nodes.
 */
export function tiptapJsonToMarkdown(doc: JSONContent): string {
  if (!doc.content) return "";
  return doc.content.map((node) => serializeNode(node, "")).join("\n\n");
}

function serializeNode(node: JSONContent, prefix: string): string {
  switch (node.type) {
    case "heading": {
      const level = node.attrs?.level ?? 1;
      const hashes = "#".repeat(level);
      return `${hashes} ${serializeInlineContent(node.content)}`;
    }

    case "paragraph":
      return `${prefix}${serializeInlineContent(node.content)}`;

    case "bulletList":
      return node.content?.map((item) => serializeListItem(item, "- ", "  ")).join("\n") ?? "";

    case "orderedList":
      return (
        node.content?.map((item, i) => serializeListItem(item, `${i + 1}. `, "   ")).join("\n") ??
        ""
      );

    case "listItem":
      // Normally handled by bulletList/orderedList, but just in case
      return serializeListItem(node, "- ", "  ");

    case "blockquote":
      return node.content?.map((child) => serializeNode(child, "> ")).join("\n") ?? "";

    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const code = serializeInlineContent(node.content);
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    case "horizontalRule":
      return "---";

    case "highlightReference": {
      const text = node.attrs?.text ?? "";
      return `> "${text}"`;
    }

    default:
      // Fallback: try to serialize content if present
      if (node.content) {
        return node.content.map((child) => serializeNode(child, prefix)).join("\n");
      }
      return node.text ? applyMarks(node.text, node.marks) : "";
  }
}

function serializeListItem(item: JSONContent, bullet: string, indent: string): string {
  if (!item.content) return bullet;
  return item.content
    .map((child, i) => {
      const line = serializeNode(child, "");
      return i === 0 ? `${bullet}${line}` : `${indent}${line}`;
    })
    .join("\n");
}

function serializeInlineContent(content?: JSONContent[]): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "text") {
        return applyMarks(node.text ?? "", node.marks);
      }
      if (node.type === "hardBreak") {
        return "\n";
      }
      // Inline nodes like highlightReference shouldn't appear here,
      // but handle gracefully
      return serializeNode(node, "");
    })
    .join("");
}

function applyMarks(text: string, marks?: JSONContent["marks"]): string {
  if (!marks || marks.length === 0) return text;
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        result = `**${result}**`;
        break;
      case "italic":
        result = `*${result}*`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "link":
        result = `[${result}](${mark.attrs?.href ?? ""})`;
        break;
    }
  }
  return result;
}
