import { waitUntil } from "@vercel/functions";
import {
  claimReadingIngestUnitWithLease,
  completeReadingIngestUnit,
  getCurrentReadingArtifacts,
  getNextDueReadingIngestUnit,
  listReadingIngestSweepUserIds,
  reclaimExpiredReadingAgentLease,
  releaseReadingIngestUnit,
  type ReadingArtifactRow,
  type ReadingArtifactUpdate,
  type ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  callReadingScribe,
  type ArtifactKind,
  type ReadingScribeCallResult,
  type ReadingScribeResult,
  type ReadingScribeUsage,
  readingScribeUsageFromError,
} from "./flue-client.server";
import { readingConversationId } from "./conversation-id.server";

export { readingConversationId };

type ReadingAgentCall = (options: {
  url?: string;
  conversationId: string;
  secret: string;
  page: string;
  artifacts: Record<ArtifactKind, string>;
}) => Promise<ReadingScribeCallResult>;

const ARTIFACT_KINDS: ArtifactKind[] = ["outline", "characters", "wiki"];

function currentBodies(rows: ReadingArtifactRow[]): Record<ArtifactKind, string> {
  return Object.fromEntries(
    ARTIFACT_KINDS.map((kind) => [kind, rows.find((row) => row.kind === kind)?.content ?? ""]),
  ) as Record<ArtifactKind, string>;
}

function changedUpdates(
  result: ReadingScribeResult,
  current: Record<ArtifactKind, string>,
): ReadingArtifactUpdate[] {
  return ARTIFACT_KINDS.flatMap((kind) => {
    const edit = result[kind];
    if (edit.status !== "updated" || edit.body === current[kind]) return [];
    return [{ kind, content: edit.body, summary: edit.summary }];
  });
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown ReadingScribe error").slice(0, 1000);
}

interface DispatchDependencies {
  claimLease: typeof claimReadingIngestUnitWithLease;
  complete: typeof completeReadingIngestUnit;
  getCurrent: typeof getCurrentReadingArtifacts;
  release: typeof releaseReadingIngestUnit;
  callAgent: ReadingAgentCall;
}

interface DrainDependencies {
  reclaim: typeof reclaimExpiredReadingAgentLease;
  getNextDue: typeof getNextDueReadingIngestUnit;
  dispatch: typeof dispatchReadingIngestUnit;
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
  callAgent: callReadingScribe,
};

export async function dispatchReadingIngestUnit(
  unit: ReadingIngestUnitRow,
  options: {
    agentUrl?: string;
    agentSecret?: string;
    dependencies?: Partial<DispatchDependencies>;
  } = {},
): Promise<"not-configured" | "already-leased" | "done" | "failed"> {
  const agentUrl = options.agentUrl ?? process.env.READING_AGENT_URL;
  const agentSecret = options.agentSecret ?? process.env.READING_AGENT_SECRET;
  if (!agentSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[reading-agent] READING_AGENT_SECRET is required; ingest remains pending.");
    }
    return "not-configured";
  }

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const claim = await dependencies.claimLease(unit.id);
  if (!claim) return "already-leased";
  const claimed = claim.unit;
  let calledAgent = false;
  let settledUsage: ReadingScribeUsage | undefined;

  try {
    const current = currentBodies(await dependencies.getCurrent(claimed.userId, claimed.bookId));
    calledAgent = true;
    const conversationId = readingConversationId(claimed.userId, claimed.bookId);
    const result = await dependencies.callAgent({
      url: agentUrl ? `${agentUrl.replace(/\/+$/, "")}/${conversationId}` : undefined,
      conversationId,
      secret: agentSecret,
      page: claimed.text,
      artifacts: current,
    });
    settledUsage = result.usage;
    const completed = await dependencies.complete(
      claim,
      changedUpdates(result.artifacts, current),
      result.usage,
    );
    if (completed === null) {
      console.error(`[reading-agent] Ingest unit ${claimed.id} settled after its lease expired.`);
      return "failed";
    }
    return "done";
  } catch (error) {
    const message = errorMessage(error);
    const usage = calledAgent ? (settledUsage ?? readingScribeUsageFromError(error)) : undefined;
    await dependencies.release(claim, message, usage).catch((releaseError) => {
      console.error("[reading-agent] Failed to release ingest unit for retry:", releaseError);
    });
    console.error(`[reading-agent] Ingest unit ${claimed.id} failed:`, message);
    return "failed";
  }
}

const DEFAULT_DRAIN_DEPENDENCIES: DrainDependencies = {
  reclaim: reclaimExpiredReadingAgentLease,
  getNextDue: getNextDueReadingIngestUnit,
  dispatch: dispatchReadingIngestUnit,
};

export async function drainReadingIngestQueue(
  userId: string,
  options: {
    agentUrl?: string;
    agentSecret?: string;
    maxUnits?: number;
    dependencies?: Partial<DrainDependencies>;
  } = {},
): Promise<void> {
  const agentUrl = options.agentUrl ?? process.env.READING_AGENT_URL;
  const agentSecret = options.agentSecret ?? process.env.READING_AGENT_SECRET;
  if (!agentSecret) return;

  const dependencies = { ...DEFAULT_DRAIN_DEPENDENCIES, ...options.dependencies };
  await dependencies.reclaim(userId);

  const maxUnits = options.maxUnits ?? Number.POSITIVE_INFINITY;
  for (let started = 0; started < maxUnits; started += 1) {
    const unit = await dependencies.getNextDue(userId);
    if (!unit) return;

    const result = await dependencies.dispatch(unit, { agentUrl, agentSecret });
    if (result === "already-leased" || result === "not-configured") return;
  }
}

const DEFAULT_SWEEP_DEPENDENCIES: SweepDependencies = {
  listUserIds: listReadingIngestSweepUserIds,
  reclaim: reclaimExpiredReadingAgentLease,
  drain: drainReadingIngestQueue,
};

export async function sweepReadingIngestQueues(
  options: {
    agentUrl?: string;
    agentSecret?: string;
    dependencies?: Partial<SweepDependencies>;
  } = {},
): Promise<number> {
  const agentUrl = options.agentUrl ?? process.env.READING_AGENT_URL;
  const agentSecret = options.agentSecret ?? process.env.READING_AGENT_SECRET;
  if (!agentSecret) return 0;

  const dependencies = { ...DEFAULT_SWEEP_DEPENDENCIES, ...options.dependencies };
  const userIds = await dependencies.listUserIds();
  await Promise.all(userIds.map((userId) => dependencies.reclaim(userId)));
  await Promise.all(
    userIds.map((userId) => dependencies.drain(userId, { agentUrl, agentSecret, maxUnits: 1 })),
  );
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
    agentSecret?: string;
  } = {},
): boolean {
  const isDev = env.isDev ?? import.meta.env.DEV;
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  const vitest = "vitest" in env ? env.vitest : process.env.VITEST;
  const databaseUrl = env.databaseUrl ?? process.env.DATABASE_URL;
  const agentSecret = env.agentSecret ?? process.env.READING_AGENT_SECRET;
  return Boolean(isDev && nodeEnv !== "test" && !vitest && databaseUrl && agentSecret);
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
