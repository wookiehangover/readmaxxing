import { updateBookBlobUrls } from "../book/book";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { checkRecoveryUpload } from "./recovery-book";
import type { RecoveryUploadGuard } from "~/lib/sync/delivery-types";

export async function validateRecoveryUpload(
  account: string,
  bookId: string,
  guard: RecoveryUploadGuard,
) {
  await withBookOwnerTransaction(account, (client) =>
    checkRecoveryUpload(client, account, bookId, guard),
  );
}
/** Check and publish share the canonical writer transaction; staged bytes have a unique URL. */
export async function publishRecoveryUpload(
  account: string,
  bookId: string,
  type: "file" | "cover",
  url: string,
  guard: RecoveryUploadGuard,
) {
  return withBookOwnerTransaction(account, async (client) => {
    await checkRecoveryUpload(client, account, bookId, guard);
    const updated = await updateBookBlobUrls(
      bookId,
      type === "cover" ? { coverBlobUrl: url } : { fileBlobUrl: url },
      account,
      client,
    );
    if (!updated) throw new Error("Book no longer available for upload");
    return updated;
  });
}
