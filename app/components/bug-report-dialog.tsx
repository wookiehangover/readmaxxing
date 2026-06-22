import { useState, type FormEvent } from "react";
import { LifeBuoy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { useAuth } from "~/lib/context/auth-context";
import { useWorkspace } from "~/lib/context/workspace-context";
import { useSettings } from "~/lib/settings";

type BugReportDialogProps = {
  readonly triggerClassName?: string;
  readonly triggerSize?: "icon" | "icon-sm";
};

type PanelSnapshot = {
  readonly id: string;
  readonly title: string | null;
  readonly component: string | null;
};

type PanelLike = {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly component?: unknown;
  readonly toJSON?: () => { readonly contentComponent?: unknown };
};

function panelId(panel: unknown): string | null {
  const value = (panel as PanelLike | null)?.id;
  return typeof value === "string" ? value : null;
}

function panelSnapshot(panel: unknown): PanelSnapshot | null {
  const candidate = panel as PanelLike | null;
  const id = panelId(candidate);
  if (!id) return null;
  const contentComponent = candidate?.toJSON?.().contentComponent;
  return {
    id,
    title: typeof candidate?.title === "string" ? candidate.title : null,
    component:
      typeof candidate?.component === "string"
        ? candidate.component
        : typeof contentComponent === "string"
          ? contentComponent
          : null,
  };
}

export function BugReportDialog({
  triggerClassName,
  triggerSize = "icon",
}: BugReportDialogProps = {}) {
  const ws = useWorkspace();
  const [settings] = useSettings();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function buildContext() {
    const api = ws.dockviewApi.current;
    const apiSnapshot = api as {
      readonly activePanel?: unknown;
      readonly activeGroup?: { readonly activePanel?: unknown } | null;
    } | null;
    const activePanelId =
      panelId(apiSnapshot?.activePanel) ?? panelId(apiSnapshot?.activeGroup?.activePanel);

    return {
      route: typeof window === "undefined" ? null : window.location.pathname,
      layoutMode: settings.layoutMode,
      zenMode: settings.zenMode,
      colorTheme: settings.colorTheme,
      theme: settings.theme,
      openBookIds: Array.from(ws.openBookIdsRef.current ?? []),
      activeBookId: ws.activeClusterBookIdRef.current ?? null,
      openPanels: api
        ? Array.from(api.panels)
            .map(panelSnapshot)
            .filter((p) => p !== null)
        : [],
      activePanelId,
      viewport:
        typeof window === "undefined"
          ? null
          : { width: window.innerWidth, height: window.innerHeight },
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      auth: {
        isAuthenticated: auth.isAuthenticated,
        userId: auth.user?.id ?? null,
      },
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/bug-report", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmedMessage, context: buildContext() }),
      });

      if (!response.ok) throw new Error("Failed to send report");

      toast.success("Report sent");
      setMessage("");
      setOpen(false);
    } catch {
      toast.error("Could not send report");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delay={400}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size={triggerSize}
                className={triggerClassName}
                onClick={() => setOpen(true)}
              />
            }
          >
            <LifeBuoy />
            <span className="sr-only">Need help?</span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            Need help?
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              Tell us what went wrong and we&apos;ll include the current app context.
            </DialogDescription>
          </DialogHeader>

          <label htmlFor="bug-report-message" className="sr-only">
            Problem description
          </label>
          <Textarea
            id="bug-report-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What's wrong? Where exactly? What did you expect?"
            rows={6}
          />

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={message.trim().length === 0 || isSubmitting}>
              {isSubmitting && <Loader2 data-icon="inline-start" className="animate-spin" />}
              Send report
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
