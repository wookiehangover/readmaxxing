export type ReadingConversationPhase =
  | "loading"
  | "connecting"
  | "live"
  | "absent"
  | "error"
  | "closed";

export type SanitizedConversationPart =
  | { type: "text"; text: string; state: "streaming" | "done" }
  | { type: "reasoning"; text: string; state: "streaming" | "done" }
  | { type: "dynamic-tool"; toolName: string; state: string; errorText?: string };

export interface SanitizedConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  purpose: string;
  display: "visible" | "hidden" | "diagnostic";
  parts: SanitizedConversationPart[];
}

export interface ReadingAgentConversation {
  phase: ReadingConversationPhase;
  conversationId: string | null;
  bookId: string | null;
  messages: SanitizedConversationMessage[];
}

export function emptyReadingAgentConversation(
  phase: ReadingConversationPhase = "absent",
): ReadingAgentConversation {
  return { phase, conversationId: null, bookId: null, messages: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function partState(value: unknown): "streaming" | "done" {
  return value === "streaming" ? "streaming" : "done";
}

function shouldRedactText(
  message: Pick<SanitizedConversationMessage, "role" | "purpose">,
): boolean {
  return message.role === "user" || message.purpose === "user" || message.purpose === "dispatch";
}

function sanitizePart(part: unknown, redactText: boolean): SanitizedConversationPart | null {
  if (!isRecord(part) || typeof part.type !== "string") return null;
  if (part.type === "text" || part.type === "reasoning") {
    if (redactText) return null;
    return {
      type: part.type,
      text: typeof part.text === "string" ? part.text : "",
      state: partState(part.state),
    };
  }
  if (part.type !== "dynamic-tool" || typeof part.toolName !== "string") return null;
  return {
    type: "dynamic-tool",
    toolName: part.toolName,
    state: typeof part.state === "string" ? part.state : "input-available",
    ...(typeof part.errorText === "string" ? { errorText: part.errorText } : {}),
  };
}

export function sanitizeConversationMessages(messages: unknown): SanitizedConversationMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (!isRecord(message) || typeof message.id !== "string") return [];
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      return [];
    }
    const sanitized: SanitizedConversationMessage = {
      id: message.id,
      role: message.role,
      purpose: typeof message.purpose === "string" ? message.purpose : message.role,
      display:
        message.display === "hidden" || message.display === "diagnostic"
          ? message.display
          : "visible",
      parts: [],
    };
    const redactText = shouldRedactText(sanitized);
    sanitized.parts = Array.isArray(message.parts)
      ? message.parts.flatMap((part) => {
          const sanitizedPart = sanitizePart(part, redactText);
          return sanitizedPart ? [sanitizedPart] : [];
        })
      : [];
    return [sanitized];
  });
}
