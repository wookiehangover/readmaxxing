import { get, update } from "idb-keyval";
import { getCustodyStore } from "./stores";

let accountId: string | undefined;
let generation = 0;
let epochWrite: Promise<void> = Promise.resolve();

/** Called by the existing auth owner before adoption or publishing the session. */
export function setCustodyAccount(ownerId?: string): void {
  if (ownerId !== accountId) {
    const logout = accountId !== undefined && ownerId === undefined;
    accountId = ownerId;
    generation++;
    if (logout) {
      epochWrite = update<string>(
        "profile-unbound-epoch",
        (previous) => {
          const installation = previous?.split(":")[1] ?? crypto.randomUUID();
          return `unbound:${installation}:${crypto.randomUUID()}`;
        },
        getCustodyStore(),
      );
      // Producers await this durable boundary; a failed logout epoch cannot silently
      // reuse earlier unbound identity. Auth state itself remains independently usable.
      void epochWrite.catch(() => {});
    }
  }
}

export function custodySession(ownerId = accountId) {
  const captured = generation;
  return {
    ownerId,
    checkActive() {
      if (captured !== generation || (accountId && ownerId !== accountId)) {
        throw new Error("Account changed; local custody retained");
      }
    },
  };
}

export async function unboundPartition(): Promise<string> {
  await epochWrite;
  const store = getCustodyStore();
  await update<string>(
    "profile-unbound-epoch",
    (value) => value ?? `unbound:${crypto.randomUUID()}:${crypto.randomUUID()}`,
    store,
  );
  return (await get<string>("profile-unbound-epoch", store))!;
}
