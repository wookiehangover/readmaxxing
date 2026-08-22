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
import { getReadingBookId } from "~/lib/reading-route";
import { useSettings } from "~/lib/settings";

type BugReportDialogProps = {
  readonly triggerClassName?: string;
  readonly triggerSize?: "icon" | "icon-sm";
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly hideTrigger?: boolean;
};

export function BugReportDialog({
  triggerClassName,
  triggerSize = "icon",
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: BugReportDialogProps = {}) {
  const [settings] = useSettings();
  const auth = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const open = controlledOpen ?? internalOpen;

  function setOpen(nextOpen: boolean) {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function buildContext() {
    const route = typeof window === "undefined" ? null : window.location.pathname;

    return {
      route,
      zenMode: settings.zenMode,
      colorTheme: settings.colorTheme,
      theme: settings.theme,
      activeBookId: route ? getReadingBookId(route) : null,
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
      {!hideTrigger && (
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
      )}

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
