import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

import type { TaggedError } from "~/lib/errors";
import type { ChatSession } from "~/lib/stores/chat-store";

export interface ChatSessionsState {
  collection: Collection<ChatSession, "id">;
  activeSessionIdsByBook: Record<string, string>;
  loadingBookIds: string[];
  loadedBookIds: string[];
  errorsByBookId: Record<string, TaggedError>;
}

export type ChatSessionCompletedCallback = (session: ChatSession) => void | Promise<void>;
export type ChatSessionDeletedCallback = (
  nextActiveSessionId: string | null,
) => void | Promise<void>;
export type ChatSessionsHydratedCallback = (
  activeSession: ChatSession | null,
) => void | Promise<void>;
export type ChatSessionFailedCallback = (error: string) => void;
