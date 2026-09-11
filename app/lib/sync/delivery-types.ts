/** Receipt custody covers the received JSON, never local Blob/ArrayBuffer bytes. */
export type DeliveryState =
  | "received"
  | "applied"
  | "covered"
  | "waiting_clock"
  | "waiting_dependency"
  | "retry_pending"
  | "needs_resolution"
  | "resolved";
export interface DeliveryReference {
  receiptId: string;
  fingerprintVersion: 1;
  payloadFingerprint: string;
  state: DeliveryState;
  reasonCode: string;
  decisionVersion: number;
}
export interface DeliverySummary extends DeliveryReference {
  ownerId: string;
  changeId: string;
  entity: string;
  entityId: string;
  sourceClock: unknown;
  receivedAt: string;
  updatedAt: string;
  targetEntityId: string | null;
  nextAttemptAt: string | null;
  attachments: Array<{ kind: "file" | "cover"; state: "not_received" }>;
}
export interface RecoveryPage {
  ownerId: string;
  receipts: DeliverySummary[];
  cursor: string;
  hasMore: boolean;
}
export interface RecoveryDetail extends DeliverySummary {
  originalSnapshot: Record<string, unknown>;
  originalReferences: Record<string, unknown>;
  decisionEvidence: unknown;
  canonicalVersion: string;
  canonical: CanonicalRecoverySnapshot;
}
/** Account-owned comparison data, read consistently with its resolution precondition. */
export interface CanonicalRecoverySnapshot {
  entity: string;
  entityId: string | null;
  status: "present" | "deleted" | "missing" | "unavailable" | "unsupported";
  /** Mutation-facing fields; timestamps are milliseconds. URLs do not prove byte custody. */
  data: Record<string, unknown> | null;
  version: string;
}
export interface RecoveryResolution {
  resolutionId: string;
  expectedDecisionVersion: number;
  expectedCanonicalVersion: string;
  action: "retry" | "keep_canonical" | "restore_copy" | "submit_edit";
  newMutation?: import("./types").ChangeEntry;
}
export interface BookAliasPage {
  ownerId: string;
  aliases: Array<{ fromId: string; toId: string; version: string }>;
  /** Account-bound cursor pins the high-water until hasMore is false; reuse for delta. */
  cursor: string;
  hasMore: boolean;
}
