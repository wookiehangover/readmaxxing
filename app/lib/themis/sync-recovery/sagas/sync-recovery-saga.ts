import { race, take, call, join, put, takeEvery, takeLatest, takeLeading } from "typed-redux-saga";
import {
  getRecoveryBookTarget,
  prepareLocalFileRecovery,
  submitLocalFileRecovery,
} from "~/lib/sync/local-recovery-files";
import {
  prepareLocalRecoveryAdmission,
  submitLocalRecoveryAdmission,
} from "~/lib/sync/local-recovery-admission";
import { discardLocalRecovery } from "~/lib/sync/custody-discard";
import { prepareRecoveryResolution, submitRecoveryResolution } from "~/lib/sync/recovery-mutations";
import type { RecoveryDetail, RecoveryResolution } from "~/lib/sync/delivery-types";
import { localRecoverySummaries } from "~/lib/sync/custody-export";
import { custodySession } from "~/lib/sync/custody-session";
import type { AppStore } from "../../store";
import {
  authSessionCleared,
  authSessionFailed,
  authSessionResolved,
  logoutRequested,
  refreshAuthSessionRequested,
} from "../../auth-session/auth-session-slice";
import { listServerRecovery } from "../recovery-api";
import {
  prepareRecoveryView,
  prepareRecoveryDownload,
  requestRecoveryDownload,
  inspectRaw,
} from "../recovery-artifacts";
import {
  recoveryLoaded,
  recoveryViewLoaded,
  recoveryCommandStarted,
  recoveryCommandFinished,
  recoveryFailed,
  refreshRecovery,
  selectRecovery,
  runRecoveryCommand,
} from "../sync-recovery-slice";
import type { RecoveryItem } from "../sync-recovery-types";

function subscribeChangelog(changed: () => void) {
  // Metadata refresh only; the existing sync engine owns delivery.
  window.addEventListener("sync:push-needed", changed);
  return () => window.removeEventListener("sync:push-needed", changed);
}

export function createSyncRecoverySaga(store: AppStore) {
  return function* syncRecoverySaga() {
    let generation = 0;
    let selection = 0;
    let viewUrl: string | null = null;
    // Selected raw data is scoped to this view, never dispatched or stored in Redux.
    let reviewedResolution: RecoveryDetail | null = null;
    let pendingAdmission: string | null = null;
    let pendingFile: { kind: "file" | "cover"; id: string } | null = null;
    let pending: { command: RecoveryResolution["action"]; id: string } | null = null;
    const selectors = store.syncRecoverySelectors;
    const auth = store.authSessionSelectors;
    function releaseView() {
      selection++;
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      viewUrl = null;
      reviewedResolution = null;
      pendingAdmission = null;
      pendingFile = null;
      pending = null;
    }
    function* load(action: ReturnType<typeof refreshRecovery>) {
      if (yield* auth.selectAuthLoading.effect()) return;
      const ownerId = (yield* auth.selectAuthUser.effect())?.id;
      const captured = generation;
      const session = custodySession(ownerId);
      const check = () => {
        session.checkActive();
        if (captured !== generation) throw new Error("Recovery session changed");
      };
      const items: RecoveryItem[] = [];
      const errors: string[] = [];
      try {
        const local = yield* call(localRecoverySummaries, ownerId);
        check();
        items.push(
          ...local.map((item) => ({
            id: `device:${item.id}`,
            source: "device" as const,
            sourceId: item.id,
            entity: item.source,
            entityId: inspectRaw(item.key),
            state: item.status as RecoveryItem["state"],
            reason: item.role,
            recordedAt: new Date(item.createdAt).toISOString(),
            receiptId: item.receiptId ?? null,
          })),
        );
      } catch {
        errors.push("Device recovery is unavailable. Refresh to try again.");
      }
      if (ownerId && action.payload[0]) {
        try {
          items.push(...(yield* call(listServerRecovery, ownerId, check)));
        } catch {
          errors.push(
            "Server recovery is unavailable. Device copies are still available. Refresh when connected.",
          );
        }
      }
      if (!action.payload[0]) {
        const previous = yield* selectors.selectRecoveryItems.effect();
        items.push(...previous.filter((item) => item.source === "server"));
      }
      try {
        check();
        yield* put(recoveryLoaded(items, errors.join(" ") || null));
      } catch {
        /* The next account load owns publication. */
      }
    }
    function* publishView(
      prepared: Awaited<ReturnType<typeof prepareRecoveryView>>,
      fileTarget?: { entityId: string; version: string },
    ) {
      if (viewUrl) URL.revokeObjectURL(viewUrl);
      viewUrl = URL.createObjectURL(prepared.blob);
      const { detail, resolution, capabilities } = prepared;
      reviewedResolution = resolution;
      yield* put(
        recoveryViewLoaded({
          fileTarget,
          token: crypto.randomUUID(),
          url: viewUrl,
          attachmentCount: prepared.attachmentCount,
          ...(resolution
            ? {
                decisionVersion: resolution.decisionVersion,
                canonicalVersion: resolution.canonicalVersion,
                resolution: {
                  entity: resolution.entity,
                  state: resolution.state,
                  canonicalStatus: resolution.canonical.status,
                },
              }
            : {}),
          ...("version" in detail ? { localVersion: detail.version } : {}),
          ...(capabilities
            ? {
                localText: capabilities.text,
                localFiles: capabilities.files,
                suggestedBookId: capabilities.suggestedBookId,
              }
            : {}),
        }),
      );
    }
    function* inspect(action: ReturnType<typeof selectRecovery>) {
      releaseView();
      if (!action.payload[0]) return;
      const item = yield* selectors.selectRecoveryItem.effect();
      if (!item) {
        yield* put(recoveryFailed("This recovery item is unavailable. Refresh the list."));
        return;
      }
      const ownerId = (yield* auth.selectAuthUser.effect())?.id;
      const captured = generation;
      const selected = selection;
      const check = () => {
        if (captured !== generation || selected !== selection)
          throw new Error("Recovery selection changed");
      };
      try {
        const prepared = yield* call(prepareRecoveryView, item, ownerId, check);
        check();
        yield* publishView(prepared);
      } catch (error) {
        if (captured === generation && selected === selection)
          yield* put(
            recoveryFailed(error instanceof Error ? error.message : "Could not inspect recovery."),
          );
      }
    }
    function* command(action: ReturnType<typeof runRecoveryCommand>) {
      const [command, token, attachment, targetBookId] = action.payload;
      const state = yield* selectors.selectRecoveryState.effect();
      const item = yield* selectors.selectRecoveryItem.effect();
      if (!item || !state.view || state.view.token !== token || state.busy) return;
      const view = state.view;
      const ownerId = (yield* auth.selectAuthUser.effect())?.id;
      const captured = generation;
      const selected = selection;
      const session = custodySession(ownerId);
      const check = () => {
        session.checkActive();
        if (captured !== generation || selected !== selection)
          throw new Error("Recovery selection changed");
      };
      yield* put(recoveryCommandStarted());
      try {
        if (command === "export" || command === "download-file") {
          const download = yield* call(
            prepareRecoveryDownload,
            item,
            ownerId,
            check,
            command === "download-file" ? attachment : undefined,
          );
          check();
          yield* call(requestRecoveryDownload, download.blob, download.filename);
          yield* put(
            recoveryCommandFinished(
              "Download requested. Check your browser downloads. The original remains retained.",
            ),
          );
          return;
        }
        if (command === "review-file-target" && item.source === "device") {
          if (!ownerId || !targetBookId) throw new Error("Choose a book from your account first.");
          const target = yield* call(getRecoveryBookTarget, ownerId, targetBookId);
          check();
          const prepared = yield* call(
            prepareRecoveryView,
            item,
            ownerId,
            check,
            reviewedResolution ?? undefined,
            target,
          );
          check();
          pendingFile = null;
          yield* publishView(prepared, {
            entityId: target.canonical.entityId!,
            version: target.canonical.version,
          });
          return;
        }
        if ((command === "upload-file" || command === "upload-cover") && item.source === "device") {
          if (!ownerId || !view.localVersion || !view.fileTarget)
            throw new Error("Review the original and current book before uploading.");
          const kind = command === "upload-file" ? "file" : "cover";
          if (pendingFile && pendingFile.kind !== kind)
            throw new Error(
              "Retry the pending file or review the target again before another upload.",
            );
          if (!pendingFile) {
            const id = yield* call(prepareLocalFileRecovery, {
              ownerId,
              id: item.sourceId,
              expectedVersion: view.localVersion,
              targetBookId: view.fileTarget.entityId,
              expectedCanonicalVersion: view.fileTarget.version,
              type: kind as "file" | "cover",
            });
            check();
            pendingFile = { kind, id };
          }
          yield* call(submitLocalFileRecovery, { ownerId, submissionId: pendingFile.id });
          check();
          yield* put(
            recoveryCommandFinished(
              "The selected file is published to the reviewed book. The original device bytes remain retained.",
            ),
          );
          yield* put(refreshRecovery(true));
          yield* put(selectRecovery(null));
          return;
        }
        if (
          command === "retry" &&
          item.source === "device" &&
          item.entity === "local-file-recovery"
        ) {
          if (!ownerId) throw new Error("Sign in to retry this saved file recovery.");
          yield* call(submitLocalFileRecovery, { ownerId, submissionId: item.sourceId });
          check();
          yield* put(
            recoveryCommandFinished(
              "File publication confirmed. The original device bytes remain retained.",
            ),
          );
          yield* put(refreshRecovery(true));
          yield* put(selectRecovery(null));
          return;
        }
        if (command === "admit" && item.source === "device") {
          if (!ownerId || !view.localVersion)
            throw new Error("Sign in and inspect this original before recovering it.");
          if (item.entity === "local-recovery-admission") pendingAdmission = item.sourceId;
          if (!pendingAdmission) {
            pendingAdmission = yield* call(prepareLocalRecoveryAdmission, {
              ownerId,
              id: item.sourceId,
              expectedVersion: view.localVersion,
            });
            check();
          }
          const admitted = yield* call(submitLocalRecoveryAdmission, {
            ownerId,
            submissionId: pendingAdmission,
          });
          check();
          const prepared = yield* call(prepareRecoveryView, item, ownerId, check, admitted);
          check();
          yield* publishView(prepared);
          yield* put(
            recoveryCommandFinished(
              "Content received for review. Compare it with the current version before choosing an edit. The original device snapshot remains retained.",
            ),
          );
          yield* put(refreshRecovery(true));
          return;
        }
        if (command === "discard" && item.source === "device") {
          if (!view.localVersion) throw new Error("Inspect this original again before discarding.");
          yield* call(discardLocalRecovery, {
            id: item.sourceId,
            expectedVersion: view.localVersion,
            ownerId,
          });
          check();
          yield* put(
            recoveryCommandFinished(
              "The selected device snapshot was discarded. Other versions were kept.",
            ),
          );
          yield* put(refreshRecovery(true));
          yield* put(selectRecovery(null));
          return;
        }
        if (
          (item.source === "server" || reviewedResolution) &&
          ["retry", "keep_canonical", "submit_edit", "restore_copy"].includes(command)
        ) {
          if (!ownerId || !reviewedResolution)
            throw new Error("Refresh and review this item before continuing.");
          const detail = reviewedResolution;
          const resolution = command as RecoveryResolution["action"];
          if (pending && pending.command !== resolution)
            throw new Error(
              "Retry the pending action or inspect the current version before making another decision.",
            );
          if (!pending) {
            const original = detail.originalSnapshot.data;
            if (
              (resolution === "submit_edit" || resolution === "restore_copy") &&
              (detail.originalSnapshot.operation !== "put" ||
                !original ||
                typeof original !== "object" ||
                Array.isArray(original))
            )
              throw new Error(
                "This original cannot be applied as content. Export it or keep the current version.",
              );
            const id = yield* call(prepareRecoveryResolution, {
              ownerId,
              detail,
              action: resolution,
              data: original as Record<string, unknown>,
            });
            check();
            pending = { command: resolution, id };
          }
          const result = yield* call(submitRecoveryResolution, {
            ownerId,
            submissionId: pending.id,
          });
          check();
          yield* put(
            recoveryCommandFinished(
              result.state === "resolved"
                ? "Decision saved. The original remains available on the server."
                : result.state === "applied"
                  ? "The edit was applied. The original remains available on the server."
                  : "Retry checked. The edit is still retained; review its current status.",
            ),
          );
          yield* put(refreshRecovery(true));
          yield* put(selectRecovery(null));
          return;
        }
        if (
          command === "retry" &&
          item.source === "device" &&
          item.entity === "recovery-resolution"
        ) {
          if (!ownerId) throw new Error("Sign in to retry this saved decision.");
          const result = yield* call(submitRecoveryResolution, {
            ownerId,
            submissionId: item.sourceId,
          });
          check();
          yield* put(
            recoveryCommandFinished(
              result.state === "resolved"
                ? "Decision confirmed. The original remains retained."
                : "Retry checked. Refresh to review the current status.",
            ),
          );
          yield* put(refreshRecovery(true));
          yield* put(selectRecovery(null));
          return;
        }
        throw new Error(
          "This action is unavailable for this original. Export it to preserve a separate copy.",
        );
      } catch (error) {
        if (captured === generation && selected === selection)
          yield* put(
            recoveryFailed(
              error instanceof Error
                ? error.message
                : "Recovery failed. The original remains retained.",
            ),
          );
      }
    }
    function* reset() {
      generation++;
      releaseView();
      yield* put(refreshRecovery());
    }
    function invalidate() {
      generation++;
      releaseView();
    }
    const unsubscribe = yield* call(subscribeChangelog, () => store.dispatch(refreshRecovery()));
    try {
      const loads = yield* takeLatest(refreshRecovery, load);
      yield* takeLatest(selectRecovery, inspect);
      yield* takeLeading(runRecoveryCommand, function* commandForCurrentView(action) {
        yield* race({
          done: call(command, action),
          changed: take([
            selectRecovery,
            authSessionResolved,
            authSessionCleared,
            authSessionFailed,
            logoutRequested,
            refreshAuthSessionRequested,
          ]),
        });
      });
      // Intentional auth fan-out: this domain cancels views; auth owns authentication.
      yield* takeEvery([authSessionResolved, authSessionCleared, authSessionFailed], reset);
      yield* takeEvery([logoutRequested, refreshAuthSessionRequested], invalidate);
      yield* put(refreshRecovery());
      // Keep resource cleanup scoped to Store disposal.
      yield* join(loads);
    } finally {
      generation++;
      releaseView();
      unsubscribe();
    }
  };
}
