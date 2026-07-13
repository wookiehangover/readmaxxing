import { useState } from "react";
import { Link } from "react-router";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useAuth } from "~/lib/context/auth-context";

const DISMISSED_KEY = "demo-welcome-banner-dismissed";

export function WelcomeBanner({ active }: { active: boolean }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [dismissed, setDismissed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(DISMISSED_KEY) !== null,
  );

  if (!active || isLoading || isAuthenticated || dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, "complete");
    setDismissed(true);
  }

  return (
    <aside
      aria-label="Demo welcome"
      className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted/40 px-2 text-xs text-muted-foreground"
    >
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap">
        <span className="truncate">
          You&apos;re reading a live demo of Readmaxxing — an AI reading companion.
        </span>
        <Button variant="link" size="xs" render={<Link to="/login" />} nativeButton={false}>
          Log in
        </Button>
        <span className="shrink-0">or keep exploring.</span>
      </div>
      <Button variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss welcome">
        <X />
      </Button>
    </aside>
  );
}
