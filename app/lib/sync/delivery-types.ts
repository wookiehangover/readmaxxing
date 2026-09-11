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
  receipts: DeliverySummary[];
  cursor: string;
  hasMore: boolean;
}
export interface RecoveryDetail extends DeliverySummary {
  originalSnapshot: Record<string, unknown>;
  originalReferences: Record<string, unknown>;
  decisionEvidence: unknown;
  canonicalVersion: string;
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
