import { get, set } from "idb-keyval";
import { authService } from "~/lib/auth-service";
import { ChatError, StorageError } from "~/lib/errors";
import {
  DEMO_CHAT_SESSION,
  DEMO_EPUB_PATH,
  DEMO_NOTEBOOK_CONTENT,
  DEMO_POSITION_CFI,
} from "~/lib/onboarding/demo-content";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import type { ChatSession } from "~/lib/stores/chat-store";
import { ReadingPositionService } from "~/lib/stores/position-store";
import { WorkspaceService } from "~/lib/stores/workspace-store";
import { getActiveSessionStore, getChatSessionStore } from "~/lib/sync/stores";

const ONBOARDING_FLAG = "demo-onboarding";

export function hasDemoOnboardingState(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(ONBOARDING_FLAG) !== null;
}

export async function isFirstVisit(): Promise<boolean> {
  if (typeof window === "undefined" || hasDemoOnboardingState()) {
    return false;
  }

  try {
    const session = await authService.getSession();
    if (session.user !== null) return false;
    return (await BookService.getBooks()).length === 0;
  } catch {
    return false;
  }
}

export async function fetchDemoEpub() {
  try {
    const response = await fetch(DEMO_EPUB_PATH);
    if (!response.ok) {
      throw new Error(`Failed to fetch demo EPUB (${response.status})`);
    }
    return response.arrayBuffer();
  } catch (cause) {
    throw new StorageError({ operation: "fetchDemoEpub", cause });
  }
}

async function saveDemoChat(bookId: string) {
  try {
    const sessionStore = getChatSessionStore();
    const activeSessionStore = getActiveSessionStore();
    const sessions = (await get<ChatSession[]>(bookId, sessionStore)) ?? [];
    const session = { ...DEMO_CHAT_SESSION, bookId };

    if (!sessions.some((existing) => existing.id === session.id)) {
      // Direct IDB writes intentionally avoid a sync change while the visitor is signed out.
      await set(bookId, [...sessions, session], sessionStore);
    }
    if (!(await get<string>(bookId, activeSessionStore))) {
      await set(bookId, session.id, activeSessionStore);
    }
  } catch (cause) {
    throw new ChatError({ operation: "saveDemoChat", cause });
  }
}

export async function provisionDemoContent(book: BookMeta) {
  if ((await ReadingPositionService.getPosition(book.id)) === null) {
    await ReadingPositionService.savePosition(book.id, DEMO_POSITION_CFI, {
      recordChange: false,
    });
  }

  if ((await AnnotationService.getNotebook(book.id)) === null) {
    await AnnotationService.saveNotebook({
      bookId: book.id,
      content: DEMO_NOTEBOOK_CONTENT,
      updatedAt: Date.now(),
    });
  }

  await saveDemoChat(book.id);
  await Promise.all([WorkspaceService.clearLayout(), WorkspaceService.clearFocusedState()]);
  return book;
}

export function completeDemoOnboarding(): void {
  window.localStorage.setItem(ONBOARDING_FLAG, "complete");
}
