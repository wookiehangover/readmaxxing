import type { IDockviewHeaderActionsProps } from "dockview";
import { BugReportDialog } from "~/components/bug-report-dialog";

export function RightHeaderActions(_props: IDockviewHeaderActionsProps) {
  return (
    <div className="flex h-full items-stretch">
      <BugReportDialog triggerClassName="h-full rounded-none border-l border-border px-1 text-muted-foreground hover:text-foreground" />
    </div>
  );
}
