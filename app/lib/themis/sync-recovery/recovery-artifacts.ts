import { strToU8, zipSync } from "fflate";
import { exportLocalRecovery, localRecoveryDetail } from "~/lib/sync/custody-export";
import { getCustodyAccess } from "~/lib/sync/custody-journal";
import { custodySession } from "~/lib/sync/custody-session";
import { localRecoveryCapabilities } from "~/lib/sync/local-recovery-source";
import type { RecoveryDetail, RecoveryBookTarget } from "~/lib/sync/delivery-types";
import type { RecoveryItem } from "./sync-recovery-types";
import { recoveryRequest, readServerRecovery } from "./recovery-api";

/** Inspection only. Portable lossless export is owned by custody-export. */
export function inspectRaw(value: unknown, seen = new Set<object>(), depth = 0): string {
  if (value === undefined) return "undefined";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Shared or circular reference — preserved in export]";
  seen.add(value);
  if (value instanceof Blob)
    return `[${value.constructor.name}: ${value.size} bytes; ${value.type || "unknown type"}]`;
  if (value instanceof ArrayBuffer) return `[ArrayBuffer: ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name}: ${value.byteLength} bytes]`;
  if (value instanceof Date) return `Date(${String(value.getTime())})`;
  if (depth > 100) return "[Nested content — inspect full export]";
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return `[Unsupported ${value.constructor?.name ?? "object"}; original remains retained]`;
  const indent = "  ".repeat(depth);
  const body = Object.keys(value)
    .map(
      (key) =>
        `${indent}  ${JSON.stringify(key)}: ${inspectRaw((value as Record<string, unknown>)[key], seen, depth + 1)}`,
    )
    .join(",\n");
  return `${Array.isArray(value) ? `Array(length=${value.length}) [` : "{"}\n${body}\n${indent}${Array.isArray(value) ? "]" : "}"}`;
}

function previewDocument(text: string): Blob {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return new Blob(
    [
      `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>:root{color-scheme:light dark}body{font:14px system-ui;margin:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escaped}</pre>`,
    ],
    { type: "text/html" },
  );
}

export async function prepareRecoveryView(
  item: RecoveryItem,
  ownerId: string | undefined,
  checkActive: () => void,
  admitted?: RecoveryDetail,
  fileTarget?: RecoveryBookTarget,
) {
  const session = custodySession(ownerId);
  let text: string;
  let detail;
  let attachmentCount = 0;
  let capabilities;
  if (item.source === "device") {
    detail = await localRecoveryDetail(item.sourceId, ownerId);
    capabilities = await localRecoveryCapabilities(detail.item);
    text = `Saved on this device\nSource: ${detail.item.source}\nKey: ${inspectRaw(detail.item.key)}\nRevision: ${detail.item.role}\nOwnership: ${detail.facts.ownerId ? "Bound to signed-in account" : "Awaiting account binding"}\n\nOriginal content\n${inspectRaw(detail.item.raw)}`;
    try {
      attachmentCount = (await exportLocalRecovery(item.sourceId, ownerId)).attachments.length;
    } catch (error) {
      // Unsupported export types are still inspectable; authorization is rechecked below.
      text += `\n\nExport unavailable: ${error instanceof Error ? error.message : "Original remains retained"}`;
    }
  } else {
    if (!ownerId) throw new Error("Sign in to inspect server recovery.");
    detail = await readServerRecovery(ownerId, item.sourceId);
    text = `Original edit\n${inspectRaw(detail.originalSnapshot)}\n\nCurrent saved version\n${inspectRaw("canonical" in detail ? detail.canonical : "Unavailable")}\n\nOriginal references\n${inspectRaw(detail.originalReferences)}\n\nDecision evidence\n${inspectRaw(detail.decisionEvidence)}\n\nServer receipts cover received metadata only. Original files on this device are listed separately.`;
  }
  if (admitted)
    text += `\n\nContent received for review (original device snapshot remains retained)\n${inspectRaw(admitted.originalSnapshot)}\n\nCurrent saved version\n${inspectRaw(admitted.canonical)}`;
  if (fileTarget)
    text += `\n\nCurrent book selected for original file recovery\n${inspectRaw(fileTarget.canonical)}\n\nUploading replaces only the selected file or cover on this exact book. Retained device bytes stay available.`;
  const blob = previewDocument(text);
  if (item.source === "device") await getCustodyAccess(item.sourceId, ownerId);
  session.checkActive();
  checkActive();
  return {
    blob,
    detail,
    attachmentCount,
    capabilities,
    resolution: admitted ?? ("canonical" in detail ? detail : null),
  };
}

export async function prepareRecoveryDownload(
  item: RecoveryItem,
  ownerId: string | undefined,
  checkActive: () => void,
  attachment?: number,
) {
  const session = custodySession(ownerId);
  let blob: Blob;
  let filename: string;
  if (item.source === "server") {
    if (!ownerId) throw new Error("Sign in to export server recovery.");
    const exported = await recoveryRequest(ownerId, `/${encodeURIComponent(item.sourceId)}/export`);
    blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
    filename = `recovery-${item.sourceId}.json`;
  } else {
    const exported = await exportLocalRecovery(item.sourceId, ownerId);
    if (attachment !== undefined) {
      const file = exported.attachments[attachment];
      if (!file) throw new Error("Original file unavailable. The snapshot remains retained.");
      blob = new Blob([file.bytes], { type: file.mime });
      filename = `original-${attachment + 1}${file.mime === "application/pdf" ? ".pdf" : file.mime === "application/epub+zip" ? ".epub" : ".bin"}`;
    } else {
      const files: Record<string, Uint8Array> = {};
      const attachments = exported.attachments.map(({ bytes, ...metadata }, index) => {
        const path = `original-${index + 1}.bin`;
        files[path] = new Uint8Array(bytes);
        return { ...metadata, path };
      });
      files["manifest.json"] = strToU8(
        JSON.stringify({ ...exported.manifest, attachments }, null, 2),
      );
      blob = new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
      filename = "readmaxxing-device-recovery.zip";
    }
    // ZIP/file preparation is outside the storage primitive's own final check.
    await getCustodyAccess(item.sourceId, ownerId);
  }
  session.checkActive();
  checkActive();
  return { blob, filename };
}

/** A click requests a download; it cannot prove a file was saved by the browser. */
export function requestRecoveryDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
