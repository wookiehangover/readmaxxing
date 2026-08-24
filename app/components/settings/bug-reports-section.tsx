import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { useBugReports, type BugReportStatus } from "~/hooks/use-bug-reports";
import { useAuth } from "~/lib/context/auth-context";
import { cn } from "~/lib/utils";

const statusLabels: Record<BugReportStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
  wont_fix: "Won't fix",
};

export function BugReportsSection() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { reports, isLoading, error, refetch } = useBugReports({
    enabled: isAuthenticated && !isAuthLoading,
  });

  return (
    <section className="flex flex-col gap-8">
      {isAuthLoading ? (
        <StateMessage>Checking sign-in status…</StateMessage>
      ) : !isAuthenticated ? (
        <div className="flex flex-col items-start gap-4">
          <StateMessage>Sign in to view bug reports you've submitted.</StateMessage>
          <Link
            to="/login"
            className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </div>
      ) : isLoading ? (
        <StateMessage>Loading bug reports…</StateMessage>
      ) : error ? (
        <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <StateMessage>{error}</StateMessage>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : reports.length === 0 ? (
        <StateMessage>You haven't submitted any reports yet.</StateMessage>
      ) : (
        <ul className="divide-y">
          {reports.map((report) => (
            <li key={report.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" title={report.message}>
                  {report.message}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submitted {formatSubmittedDate(report.createdAt)}
                </p>
              </div>
              <StatusBadge status={report.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function StatusBadge({ status }: { status: BugReportStatus }) {
  return (
    <span
      className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", {
        "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300":
          status === "new",
        "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300":
          status === "triaged",
        "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300":
          status === "in_progress",
        "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300":
          status === "resolved",
        "border-muted bg-muted text-muted-foreground": status === "closed",
        "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300":
          status === "wont_fix",
      })}
    >
      {statusLabels[status]}
    </span>
  );
}

function formatSubmittedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
