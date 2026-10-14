import type { UIMessage } from "@ai-sdk/react";
import { getToolInfo, joinTextParts } from "./chat-utils";

export type MessageSegment =
  | { type: "text"; key: string; text: string }
  | { type: "steps"; key: string; parts: UIMessage["parts"] };

export function segmentParts(parts: UIMessage["parts"]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  parts.forEach((part, index) => {
    const last = segments.at(-1);
    if (part.type === "text") {
      if (!part.text) return;
      if (last?.type === "text") last.text = joinTextParts([last.text, part.text]);
      else segments.push({ type: "text", key: `t-${index}`, text: part.text });
      return;
    }
    if (part.type === "reasoning") {
      if (!(typeof part.text === "string" && part.text.trim()) && part.state !== "streaming")
        return;
    } else if (!getToolInfo(part)) return;
    if (last?.type === "steps") last.parts.push(part);
    else segments.push({ type: "steps", key: `s-${index}`, parts: [part] });
  });
  return segments;
}
