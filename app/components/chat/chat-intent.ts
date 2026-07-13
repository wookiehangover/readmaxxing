export type ChatIntent =
  | { type: "typed"; text: string }
  | { type: "suggested"; text: string }
  | { type: "none" };

export function resolvePendingChatMessage(intent: ChatIntent): string | null {
  if (intent.type === "none") return null;
  return intent.text.trim() || null;
}
