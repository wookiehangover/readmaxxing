import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";
import type { DeliveryState } from "~/lib/sync/delivery-types";

/** Only metadata and revocable view handles; original content stays in custody. */
export interface RecoveryItem {
  id: string;
  source: "server" | "device";
  sourceId: string;
  entity: string;
  entityId: string;
  state:
    | DeliveryState
    | "needs-account-binding"
    | "local-not-received"
    | "raw-not-covered"
    | "ownership-conflict";
  reason: string;
  recordedAt: string;
  receiptId: string | null;
}
export interface RecoveryView {
  token: string;
  url: string;
  decisionVersion?: number;
  canonicalVersion?: string;
  localVersion?: string;
  attachmentCount: number;
  localText?: boolean;
  localFiles?: ("file" | "cover")[];
  suggestedBookId?: string;
  resolution?: { entity: string; state: DeliveryState; canonicalStatus: string };
  fileTarget?: { entityId: string; version: string };
}
export type RecoveryCommand =
  | "export"
  | "download-file"
  | "admit"
  | "review-file-target"
  | "upload-file"
  | "upload-cover"
  | "retry"
  | "keep_canonical"
  | "submit_edit"
  | "restore_copy"
  | "discard";
export interface SyncRecoveryState {
  items: Collection<RecoveryItem, "id">;
  selectedId: string | null;
  view: RecoveryView | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
}
