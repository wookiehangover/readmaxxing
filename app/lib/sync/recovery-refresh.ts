import { custodySession } from "./custody-session";

/** Feed confirmed recovery writes into the existing authenticated pull owner. */
export function requestRecoveryPull(ownerId: string): void {
  if (typeof window === "undefined") return;
  const session = custodySession(ownerId);
  queueMicrotask(() => {
    try {
      session.checkActive();
    } catch {
      return;
    }
    window.dispatchEvent(new CustomEvent("sync:recovery-applied", { detail: { ownerId } }));
  });
}
