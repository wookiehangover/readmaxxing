import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { triggerUpdateCheck } from "~/lib/sw-registry";

export function UpdatesSection() {
  const [lastUpdateCheck, setLastUpdateCheck] = useState<Date | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  async function handleCheckForUpdates() {
    setIsCheckingUpdates(true);
    try {
      const result = await triggerUpdateCheck();
      setLastUpdateCheck(new Date());

      if (!result.checked) {
        toast("Service worker not active");
      } else if (result.updateFound) {
        toast.success("Update available — refresh to apply");
      } else {
        toast("You're on the latest version");
      }
    } catch (cause) {
      console.error(cause);
      toast("Could not check for updates");
    } finally {
      setIsCheckingUpdates(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <span className="block text-sm font-medium">Updates</span>
          <span className="text-xs text-muted-foreground">
            Last checked:{" "}
            {lastUpdateCheck
              ? lastUpdateCheck.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "Never"}
          </span>
        </div>
        <Button
          variant="outline"
          onClick={() => void handleCheckForUpdates()}
          disabled={isCheckingUpdates}
        >
          {isCheckingUpdates ? "Checking…" : "Check for updates"}
        </Button>
      </div>
    </section>
  );
}
