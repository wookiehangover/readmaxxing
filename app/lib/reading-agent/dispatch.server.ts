import { waitUntil } from "@vercel/functions";
import {
  claimReadingIngestUnitWithLease,
  completeReadingIngestUnit,
  getCurrentReadingArtifacts,
  getLiveReadingAgentLease,
  getNextDueReadingIngestUnit,
  listReadingIngestSweepUserIds,
  reclaimExpiredReadingAgentLease,
  releaseReadingIngestUnit,
  stopReadingIngestUnit,
  type ReadingArtifactRow,
  type ReadingArtifactUpdate,
  type ReadingAgentUsage,
  type ReadingAgentStatusLeaseRow,
  type ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import { hasActiveReadingAgentHost } from "./agent-host.server";
import { readingConversationId } from "./conversation-id.server";
import { getSelectedDebugModel, type DebugReadingAgentModel } from "./debug-model.server";
import { getOutlineChapterBullets, mergeOutlineMarkdown } from "./outline-merge";
import {
  callPageIncrement,
  pageIncrementUsageFromError,
  type PageIncrementCallResult,
} from "./page-increment.server";

export { readingConversationId };

export const ORPHANED_READING_AGENT_ERROR =
  "Reading agent host lost after the app process restarted";

type PageIncrementCall = (options: {
  model: DebugReadingAgentModel;
  page: string;
  chapterLabel: string | null;
  existingBullets: readonly string[];
}) => Promise<PageIncrementCallResult>;

function currentOutline(rows: ReadingArtifactRow[]): string {
  return rows.find((row) => row.kind === "outline")?.content ?? "";
}

function outlineUpdate(current: string, merged: string): ReadingArtifactUpdate[] {
  if (merged === current) return [];
  return [{ kind: "outline", content: merged, summary: "Added this page's outline increment." }];
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown page increment error").slice(0, 1000);
}

interface DispatchDependencies {
  claimLease: typeof claimReadingIngestUnitWithLease;
  complete: typeof completeReadingIngestUnit;
  getCurrent: typeof getCurrentReadingArtifacts;
  release: typeof releaseReadingIngestUnit;
  callIncrement: PageIncrementCall;
}

interface DrainDependencies {
  reclaim: (userId: string) => Promise<unknown>;
  getNextDue: typeof getNextDueReadingIngestUnit;
  dispatch: typeof dispatchReadingIngestUnit;
}

interface OrphanReclaimDependencies {
  getLease: typeof getLiveReadingAgentLease;
  getActiveHost: typeof hasActiveReadingAgentHost;
  stopUnit: typeof stopReadingIngestUnit;
}

interface SweepDependencies {
  listUserIds: typeof listReadingIngestSweepUserIds;
  reclaim: typeof reclaimExpiredReadingAgentLease;
  drain: typeof drainReadingIngestQueue;
}

const DEFAULT_DEPENDENCIES: DispatchDependencies = {
  claimLease: claimReadingIngestUnitWithLease,
  complete: completeReadingIngestUnit,
  getCurrent: getCurrentReadingArtifacts,
  release: releaseReadingIngestUnit,
  callIncrement: callPageIncrement,
};

export async function dispatchReadingIngestUnit(
  unit: ReadingIngestUnitRow,
  options: {
    dependencies?: Partial<DispatchDependencies>;
  } = {},
): Promise<"already-leased" | "done" | "failed"> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const claim = await dependencies.claimLease(unit.id);
  if (!claim) return "already-leased";
  const claimed = claim.unit;
  const model = getSelectedDebugModel();
  let calledIncrement = false;
  let settledUsage: ReadingAgentUsage | undefined;

  try {
    const current = currentOutline(await dependencies.getCurrent(claimed.userId, claimed.bookId));
    calledIncrement = true;
    const result = await dependencies.callIncrement({
      model,
      page: claimed.text,
      chapterLabel: claimed.chapterLabel,
      existingBullets: getOutlineChapterBullets(current, claimed.chapterLabel),
    });
    settledUsage = result.usage;
    const merged = mergeOutlineMarkdown(current, claimed.chapterLabel, result.bullets);
    const completed = await dependencies.complete(
      claim,
      outlineUpdate(current, merged),
      result.usage,
    );
    if (completed === null) {
      await dependencies
        .release(claim, "Reading agent completion lease is no longer live")
        .catch((releaseError) => {
          console.error("[reading-agent] Failed to clean up unsettled ingest unit:", releaseError);
        });
      console.error(`[reading-agent] Ingest unit ${claimed.id} settled without a live lease.`);
      return "failed";
    }
    return "done";
  } catch (error) {
    const message = errorMessage(error);
    const usage = calledIncrement
      ? (settledUsage ?? pageIncrementUsageFromError(error, model))
      : undefined;
    await dependencies.release(claim, message, usage).catch((releaseError) => {
      console.error("[reading-agent] Failed to release ingest unit for retry:", releaseError);
    });
    console.error(`[reading-agent] Ingest unit ${claimed.id} failed:`, message);
    return "failed";
  }
}

const DEFAULT_ORPHAN_RECLAIM_DEPENDENCIES: OrphanReclaimDependencies = {
  getLease: getLiveReadingAgentLease,
  getActiveHost: hasActiveReadingAgentHost,
  stopUnit: stopReadingIngestUnit,
};

export async function reclaimOrphanedReadingAgentLease(
  userId: string,
  options: {
    lease?: ReadingAgentStatusLeaseRow;
    dependencies?: Partial<OrphanReclaimDependencies>;
  } = {},
): Promise<boolean> {
  const dependencies = {
    ...DEFAULT_ORPHAN_RECLAIM_DEPENDENCIES,
    ...options.dependencies,
  };
  const lease = options.lease ?? (await dependencies.getLease(userId));
  if (!lease) return false;
  const conversationId = readingConversationId(userId, lease.bookId, lease.unitId);
  if (dependencies.getActiveHost(conversationId)) return false;
  return dependencies.stopUnit(userId, lease.unitId, ORPHANED_READING_AGENT_ERROR);
}

export async function reclaimStaleReadingAgentLease(userId: string): Promise<void> {
  await reclaimExpiredReadingAgentLease(userId);
}

const DEFAULT_DRAIN_DEPENDENCIES: DrainDependencies = {
  reclaim: reclaimStaleReadingAgentLease,
  getNextDue: getNextDueReadingIngestUnit,
  dispatch: dispatchReadingIngestUnit,
};

export async function drainReadingIngestQueue(
  userId: string,
  options: {
    maxUnits?: number;
    dependencies?: Partial<DrainDependencies>;
  } = {},
): Promise<void> {
  const dependencies = { ...DEFAULT_DRAIN_DEPENDENCIES, ...options.dependencies };
  await dependencies.reclaim(userId);

  const maxUnits = options.maxUnits ?? Number.POSITIVE_INFINITY;
  for (let started = 0; started < maxUnits; started += 1) {
    const unit = await dependencies.getNextDue(userId);
    if (!unit) return;

    const result = await dependencies.dispatch(unit);
    if (result === "already-leased") return;
  }
}

const DEFAULT_SWEEP_DEPENDENCIES: SweepDependencies = {
  listUserIds: listReadingIngestSweepUserIds,
  reclaim: reclaimExpiredReadingAgentLease,
  drain: drainReadingIngestQueue,
};

export async function sweepReadingIngestQueues(
  options: {
    dependencies?: Partial<SweepDependencies>;
  } = {},
): Promise<number> {
  const dependencies = { ...DEFAULT_SWEEP_DEPENDENCIES, ...options.dependencies };
  const userIds = await dependencies.listUserIds();
  await Promise.all(userIds.map((userId) => dependencies.reclaim(userId)));
  await Promise.all(userIds.map((userId) => dependencies.drain(userId, { maxUnits: 1 })));
  return userIds.length;
}

export function scheduleReadingIngestQueue(userId: string): void {
  const job = drainReadingIngestQueue(userId);
  try {
    waitUntil(job);
  } catch (error) {
    console.error("[reading-agent] Failed to register background ingest:", error);
    void job.catch((jobError) => {
      console.error("[reading-agent] Background ingest failed:", jobError);
    });
  }
}

const LOCAL_READING_INGEST_SWEEP_MS = 60_000;
const localSweepGuardKey = Symbol.for("readmaxxing.localReadingIngestSweep");

interface LocalSweepGuard {
  started: boolean;
  interval?: ReturnType<typeof setInterval>;
}

function getLocalSweepGuard(): LocalSweepGuard {
  const globalRef = globalThis as typeof globalThis & {
    [localSweepGuardKey]?: LocalSweepGuard;
  };
  globalRef[localSweepGuardKey] ??= { started: false };
  return globalRef[localSweepGuardKey];
}

export function shouldStartLocalReadingIngestSweep(
  env: {
    isDev?: boolean;
    nodeEnv?: string;
    vitest?: string;
    databaseUrl?: string;
    gatewayApiKey?: string;
  } = {},
): boolean {
  const isDev = env.isDev ?? import.meta.env.DEV;
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  const vitest = "vitest" in env ? env.vitest : process.env.VITEST;
  const databaseUrl = env.databaseUrl ?? process.env.DATABASE_URL;
  const gatewayApiKey = env.gatewayApiKey ?? process.env.AI_GATEWAY_API_KEY;
  return Boolean(isDev && nodeEnv !== "test" && !vitest && databaseUrl && gatewayApiKey);
}

export function resetLocalReadingIngestSweep(): void {
  const guard = getLocalSweepGuard();
  if (guard.interval) clearInterval(guard.interval);
  guard.started = false;
  guard.interval = undefined;
}

export function startLocalReadingIngestSweep(
  options: {
    env?: Parameters<typeof shouldStartLocalReadingIngestSweep>[0];
    sweep?: () => Promise<number>;
    setIntervalFn?: typeof setInterval;
  } = {},
): boolean {
  if (!shouldStartLocalReadingIngestSweep(options.env)) return false;

  const guard = getLocalSweepGuard();
  if (guard.started) return false;
  guard.started = true;

  const sweep = options.sweep ?? sweepReadingIngestQueues;
  const schedule = options.setIntervalFn ?? setInterval;
  console.info("[reading-agent] Local ingest sweep started (every 60s).");
  const run = () => {
    void sweep().catch((error) => {
      console.error("[reading-agent] Local ingest sweep failed:", error);
    });
  };
  run();
  guard.interval = schedule(run, LOCAL_READING_INGEST_SWEEP_MS);
  guard.interval.unref?.();
  return true;
}
