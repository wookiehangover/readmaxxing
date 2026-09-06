import { get } from "idb-keyval";
import { DEMO_BOOK_ID } from "./demo-content";
import {
  prepareAdoptedDemoContent,
  resolveAdoptedDemo,
  type AdoptedDemo,
} from "./adopt-demo-local";
import type { BookMeta } from "~/lib/stores/book-store";
import { ensureBookChaptersUploaded } from "~/lib/sync/book-chapter-uploads";
import { getUnsyncedChanges } from "~/lib/sync/change-log";
import { PUSH_BATCH_SIZE, pushChangesWithResult } from "~/lib/sync/push";
import { getBookStore } from "~/lib/sync/stores";

export async function hasUnadoptedDemoBook(): Promise<boolean> {
  const book = await get<BookMeta>(DEMO_BOOK_ID, getBookStore());
  return Boolean(book && book.deletedAt == null);
}

export async function persistAdoptedDemoContent(userId: string): Promise<AdoptedDemo> {
  await prepareAdoptedDemoContent(userId);
  const context = {
    fileUploadContext: { userId, uploadRetryState: new Map() },
    isStopped: () => false,
    scheduleFollowUpPush: () => {},
  };
  const pending = await getUnsyncedChanges(userId);
  const maxBatches = Math.max(1, Math.ceil(pending.length / PUSH_BATCH_SIZE) + 1);
  for (let attempt = 0; attempt <= maxBatches; attempt++) {
    const adopted = await resolveAdoptedDemo(userId);
    const remaining = (await getUnsyncedChanges(userId)).filter(
      (change) =>
        change.entityId === adopted.bookId ||
        (change.data &&
          typeof change.data === "object" &&
          "bookId" in change.data &&
          change.data.bookId === adopted.bookId),
    );
    if (!remaining.length) {
      await ensureBookChaptersUploaded(adopted.bookId);
      return adopted;
    }
    if (attempt === maxBatches || !(await pushChangesWithResult(context))) break;
  }
  throw new Error("The demo library could not be saved to your account. Please try again.");
}
