import type { PoolClient } from "pg";
import { withBookOwnerTransaction } from "../book/canonical-book-write";
import { canonicalSnapshot } from "./canonical-version";
import { RecoveryConflict } from "./recovery";
import type { RecoveryBookTarget, RecoveryUploadGuard } from "~/lib/sync/delivery-types";

async function bookSnapshot(client: PoolClient, account: string, bookId: string, lock = true) {
  const { exists: _exists, ...canonical } = await canonicalSnapshot(
    client,
    {
      accountId: account,
      targetEntityId: null,
      originalSnapshot: { entity: "book", entityId: bookId },
    },
    lock,
  );
  return canonical;
}
/** Read-only lookup: does not create a receipt, a book, or an ownership binding. */
export async function getRecoveryBook(
  account: string,
  bookId: string,
): Promise<RecoveryBookTarget> {
  return withBookOwnerTransaction(
    account,
    async (client) => ({
      ownerId: account,
      canonical: await bookSnapshot(client, account, bookId, false),
    }),
    undefined,
    "repeatable read",
  );
}
export async function checkRecoveryUpload(
  client: PoolClient,
  account: string,
  bookId: string,
  guard: RecoveryUploadGuard,
) {
  if (guard.ownerId !== account) throw new RecoveryConflict("Recovery account changed");
  const canonical = await bookSnapshot(client, account, bookId);
  if (
    canonical.entityId !== bookId ||
    canonical.status !== "present" ||
    canonical.version !== guard.expectedCanonicalVersion
  )
    throw new RecoveryConflict("Recovery file target changed");
}
export function parseRecoveryUploadGuard(value: unknown): RecoveryUploadGuard | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new TypeError("Invalid recovery upload guard");
  const guard = value as RecoveryUploadGuard;
  if (
    typeof guard.ownerId !== "string" ||
    !guard.ownerId ||
    typeof guard.expectedCanonicalVersion !== "string" ||
    !guard.expectedCanonicalVersion
  )
    throw new TypeError("Invalid recovery upload guard");
  return { ownerId: guard.ownerId, expectedCanonicalVersion: guard.expectedCanonicalVersion };
}
