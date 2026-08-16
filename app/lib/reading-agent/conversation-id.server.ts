import { createHash } from "node:crypto";

export function readingConversationId(userId: string, bookId: string, unitId: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\0")
    .update(bookId)
    .update("\0")
    .update(unitId)
    .digest("hex");
}
