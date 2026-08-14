import { Effect } from "effect";
import { Activity, ArrowLeft, CircleAlert, Clock3, Database, Inbox, Server } from "lucide-react";
import { useCallback } from "react";
import { Link, redirect } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { ConversationCard } from "~/components/reading-agent/conversation-card";
import { useReadingAgentActions } from "~/hooks/use-reading-agent-actions";
import { useReadingAgentConversation } from "~/hooks/use-reading-agent-conversation";
import {
  type ReadingAgentStatus,
  type ReadingAgentUnitStatus,
  useReadingAgentStatus,
} from "~/hooks/use-reading-agent-status";
import { AuthService } from "~/lib/auth-service";
import { AppRuntime } from "~/lib/effect-runtime";
import { readingAgentActionAvailability } from "~/lib/reading-agent/actions-client";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Reading agent debug · Readmaxxing" }];
}

export async function clientLoader() {
  const session = await AppRuntime.runPromise(
    AuthService.pipe(Effect.andThen((service) => service.getSession())),
  );
  if (!session.user) throw redirect("/login");
  return {};
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading reading-agent status…</p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function statusVariant(status: ReadingAgentUnitStatus) {
  if (status === "error") return "destructive" as const;
  if (status === "processing") return "default" as const;
  if (status === "pending") return "secondary" as const;
  return "outline" as const;
}

function LoadingCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((item) => (
        <Card key={item}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-20 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HealthCards({ status }: { status: ReadingAgentStatus }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Agent host</CardTitle>
          <CardDescription>Flue runtime configuration</CardDescription>
          <CardAction>
            <Badge variant={status.hostConfigured ? "default" : "destructive"}>
              {status.hostConfigured ? "Configured" : "Not configured"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-muted-foreground">
          <Server className="size-5" aria-hidden="true" />
          {status.hostConfigured
            ? "Agent dispatch is available."
            : "Jobs can queue, but the agent host cannot be started."}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schema health</CardTitle>
          <CardDescription>Reading queue migration readiness</CardDescription>
          <CardAction>
            <Badge variant={status.schema.ok ? "outline" : "destructive"}>
              {status.schema.ok ? "Healthy" : "Unhealthy"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-muted-foreground">
          <Database className="size-5" aria-hidden="true" />
          {status.schema.ok
            ? "All required queue columns are present."
            : "Migration 016 is incomplete."}
        </CardContent>
      </Card>
    </div>
  );
}

function LeaseCard({
  lease,
  canStop,
  pending,
  onStop,
}: {
  lease: ReadingAgentStatus["lease"];
  canStop: boolean;
  pending: boolean;
  onStop: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current lease</CardTitle>
        <CardDescription>The one ReadingScribe job allowed to run for this user</CardDescription>
        <CardAction className="flex items-center gap-2">
          {lease ? <Badge>Processing</Badge> : null}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!canStop || pending}
            onClick={onStop}
          >
            Stop
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {lease ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Book</dt>
              <dd className="mt-1 font-mono text-xs break-all">{lease.bookId}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Chapter / locator</dt>
              <dd className="mt-1 text-sm break-all">{lease.chapterLabel || lease.locator}</dd>
              {lease.chapterLabel && (
                <dd className="mt-1 font-mono text-xs break-all">{lease.locator}</dd>
              )}
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Expires</dt>
              <dd className="mt-1 text-sm">{formatDate(lease.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Unit</dt>
              <dd className="mt-1 font-mono text-xs break-all">{lease.unitId}</dd>
            </div>
          </dl>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock3 />
              </EmptyMedia>
              <EmptyTitle>No active lease</EmptyTitle>
              <EmptyDescription>No reading-agent job is processing right now.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function UsageCard({ usage }: { usage: ReadingAgentStatus["usage"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest usage</CardTitle>
        <CardDescription>Token metadata from the most recent settled call</CardDescription>
      </CardHeader>
      <CardContent>
        {usage ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Total tokens</dt>
              <dd className="mt-1 text-lg font-semibold">{usage.totalTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Input / output</dt>
              <dd className="mt-1 text-sm">
                {usage.input.toLocaleString()} / {usage.output.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cache read / write</dt>
              <dd className="mt-1 text-sm">
                {usage.cacheRead.toLocaleString()} / {usage.cacheWrite.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Model</dt>
              <dd className="mt-1 text-sm break-all">{usage.model || "Unknown"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="mt-1 text-sm">{usage.source}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Recorded</dt>
              <dd className="mt-1 text-sm">{formatDate(usage.createdAt)}</dd>
            </div>
          </dl>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Activity />
              </EmptyMedia>
              <EmptyTitle>No usage recorded</EmptyTitle>
              <EmptyDescription>A settled agent call will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function UnitsCard({
  units,
  canRetry,
  canReset,
  pending,
  onRetry,
  onReset,
}: {
  units: ReadingAgentStatus["units"];
  canRetry: boolean;
  canReset: boolean;
  pending: boolean;
  onRetry: (unitId: string) => void;
  onReset: (unitId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent ingest units</CardTitle>
        <CardDescription>Newest first, with page text intentionally omitted</CardDescription>
      </CardHeader>
      <CardContent>
        {units.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>No recent ingest units</EmptyTitle>
              <EmptyDescription>
                Keep a book page visible for ten seconds to enqueue one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Book / location</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Next retry</TableHead>
                <TableHead>Last error</TableHead>
                <TableHead className="w-40"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => {
                const retryable = unit.status !== "done" && unit.status !== "skipped";
                return (
                  <TableRow
                    key={unit.unitId}
                    className={cn({
                      "bg-destructive/5": unit.status === "error",
                      "bg-primary/5": unit.status === "processing",
                    })}
                  >
                    <TableCell>
                      <Badge variant={statusVariant(unit.status)}>{unit.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{unit.bookId}</div>
                      <div className="mt-1 max-w-80 whitespace-normal">
                        {unit.chapterLabel || unit.locator}
                      </div>
                      {unit.chapterLabel && (
                        <div className="mt-1 max-w-80 font-mono text-xs whitespace-normal text-muted-foreground">
                          {unit.locator}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{unit.attemptCount}</TableCell>
                    <TableCell>{formatDate(unit.nextAttemptAt)}</TableCell>
                    <TableCell
                      className={cn("max-w-96 whitespace-normal", {
                        "text-destructive": Boolean(unit.lastError),
                      })}
                    >
                      {unit.lastError || "—"}
                    </TableCell>
                    <TableCell>
                      {retryable ? (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={!canRetry || pending}
                            onClick={() => onRetry(unit.unitId)}
                          >
                            Retry
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="secondary"
                            disabled={!canReset || pending}
                            onClick={() => onReset(unit.unitId)}
                          >
                            Reset
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReadingAgentDebugPage() {
  const { data, error, isLoading, updatedAt, refetch: refetchStatus } = useReadingAgentStatus();
  const {
    data: conversation,
    error: conversationError,
    refetch: refetchConversation,
  } = useReadingAgentConversation();
  const refresh = useCallback(async () => {
    await Promise.all([refetchStatus(), refetchConversation()]);
  }, [refetchConversation, refetchStatus]);
  const {
    pending,
    error: actionError,
    start,
    stop,
    retry,
    reset,
  } = useReadingAgentActions(refresh);
  const availability = data
    ? readingAgentActionAvailability(data)
    : { canStart: false, canStop: false, canRetry: false, canReset: false };

  return (
    <main className="min-h-dvh bg-background px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> Home
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Reading agent debug</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Live queue health for the signed-in reader.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={!availability.canStart || pending}
                onClick={start}
              >
                Start
              </Button>
              <p className="text-xs text-muted-foreground">
                {updatedAt
                  ? `Updated ${formatDate(updatedAt.toISOString())}`
                  : "Waiting for status…"}
              </p>
            </div>
          </div>
        </header>

        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Unable to load reading-agent status</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {actionError && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        )}
        {isLoading && !data ? <LoadingCards /> : null}
        {data ? <HealthCards status={data} /> : null}

        {data && !data.hostConfigured && (
          <Alert variant="destructive">
            <Server />
            <AlertTitle>Agent host is not configured</AlertTitle>
            <AlertDescription>
              Set READING_AGENT_SECRET before queued jobs can run.
            </AlertDescription>
          </Alert>
        )}

        {data && !data.schema.ok && (
          <Alert variant="destructive">
            <Database />
            <AlertTitle>Schema unhealthy</AlertTitle>
            <AlertDescription>
              Queue status is unavailable. Missing columns:{" "}
              {data.schema.missingColumns?.join(", ") || "unknown"}.
            </AlertDescription>
          </Alert>
        )}

        {data?.schema.ok ? (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <LeaseCard
                lease={data.lease}
                canStop={availability.canStop}
                pending={pending}
                onStop={stop}
              />
              <UsageCard usage={data.usage} />
            </div>
            <ConversationCard conversation={conversation} error={conversationError} />
            <UnitsCard
              units={data.units}
              canRetry={availability.canRetry}
              canReset={availability.canReset}
              pending={pending}
              onRetry={retry}
              onReset={reset}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
