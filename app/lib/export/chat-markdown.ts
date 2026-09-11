import type { ChatMessageRow, ChatSessionRow } from "~/lib/database/chat/chat-session";

/** Export visible conversation text, excluding internal reasoning and tool payloads. */
export function chatToMarkdown(
  session: Pick<ChatSessionRow, "id" | "title" | "activeStreamId">,
  messages: ChatMessageRow[],
): string {
  const sections = [
    `# ${(session.title || "Untitled chat").replace(/[\r\n]+/g, " ")}`,
    `Session: ${session.id}`,
  ];
  if (session.activeStreamId)
    sections.push(
      "> A response is still being generated. This export contains saved messages only.",
    );
  for (const message of messages) {
    const textParts = Array.isArray(message.parts)
      ? message.parts.filter(
          (part): part is { type: "text"; text: string } =>
            part?.type === "text" && typeof part.text === "string",
        )
      : [];
    const text = textParts.length
      ? textParts.map((part) => part.text).join("\n\n")
      : (message.content ?? "");
    if (!text) continue;
    const role =
      message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System";
    sections.push(`## ${role}\n\n${text}`);
  }
  return sections.join("\n\n");
}
