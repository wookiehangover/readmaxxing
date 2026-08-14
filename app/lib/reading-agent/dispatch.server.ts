import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import {
  claimReadingIngestUnitWithLease,
  completeReadingIngestUnit,
  getCurrentReadingArtifacts,
  releaseReadingIngestUnit,
  type ReadingArtifactRow,
  type ReadingArtifactUpdate,
  type ReadingIngestUnitRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import {
  callReadingScribe,
  type ArtifactKind,
  type ReadingScribeResult,
} from "./flue-client.server";
type ReadingAgentCall = (options: {
  url: string;
  secret: string;
  page: string;
  artifacts: Record<ArtifactKind, string>;
}) => Promise<ReadingScribeResult>;

const ARTIFACT_KINDS: ArtifactKind[] = ["outline", "characters", "wiki"];

export function readingConversationId(userId: string, bookId: string): string {
  return createHash("sha256").update(userId).update("\0").update(bookId).digest("hex");
}

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
  if (!agentUrl || !agentSecret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[reading-agent] READING_AGENT_URL and READING_AGENT_SECRET are required; ingest remains pending.",
      );
    }
    return "not-configured";
  }

  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const claim = await dependencies.claimLease(unit.id);
  if (!claim) return "already-leased";
  const claimed = claim.unit;

  try {
    const current = currentBodies(await dependencies.getCurrent(claimed.userId, claimed.bookId));
    const result = await dependencies.callAgent({
      url: `${agentUrl.replace(/\/+$/, "")}/${readingConversationId(claimed.userId, claimed.bookId)}`,
      secret: agentSecret,
      page: claimed.text,
      artifacts: current,
    });
    await dependencies.complete(claim, changedUpdates(result, current));
    return "done";
  } catch (error) {
    const message = errorMessage(error);
    await dependencies.release(claim, message).catch((releaseError) => {
      console.error("[reading-agent] Failed to release ingest unit for retry:", releaseError);
    });
    console.error(`[reading-agent] Ingest unit ${claimed.id} failed:`, message);
    return "failed";
  }
}

export function scheduleReadingIngestUnit(unit: ReadingIngestUnitRow): void {
  const job = dispatchReadingIngestUnit(unit);
  try {
    waitUntil(job);
  } catch (error) {
    console.error("[reading-agent] Failed to register background ingest:", error);
    void job.catch((jobError) => {
      console.error("[reading-agent] Background ingest failed:", jobError);
    });
  }
}
