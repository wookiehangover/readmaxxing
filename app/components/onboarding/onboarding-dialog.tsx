import { useEffect, useState } from "react";
import { Cause, Effect, Runtime } from "effect";
import { Loader2 } from "lucide-react";
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
import { AuthService } from "~/lib/auth-service";
import { useAuth } from "~/lib/context/auth-context";
import { AppRuntime } from "~/lib/effect-runtime";

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && Runtime.FiberFailureCauseId in error) {
    const cause = (error as any)[Runtime.FiberFailureCauseId];
    const failure = cause ? Array.from(Cause.failures(cause))[0] : null;
    if (failure && typeof failure === "object" && "cause" in failure) {
      const original = (failure as { cause: unknown }).cause;
      if (original instanceof Error) return original.message;
      if (typeof original === "string") return original;
    }
    if (failure instanceof Error) return failure.message;
  }
  if (error instanceof Error && error.cause instanceof Error) return error.cause.message;
  if (error instanceof Error && error.message !== "An error has occurred") return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

export function OnboardingDialog({
  open,
  onOpenChange,
  onAuthenticated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated?: (userId: string) => void | Promise<void>;
}) {
  const { refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"register" | "signin" | "setup" | null>(null);
  const isLoading = loadingAction !== null;

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  const finishAuth = async (userId: string) => {
    setLoadingAction("setup");
    if (onAuthenticated) await onAuthenticated(userId);
    else onOpenChange(false);
    refreshAuth();
  };

  async function handleRegister() {
    setError(null);
    setLoadingAction("register");
    try {
      const result = await AppRuntime.runPromise(
        AuthService.pipe(Effect.andThen((service) => service.register("Reader"))),
      );
      await finishAuth(result.userId);
    } catch (authError: unknown) {
      console.error("Register failed:", authError);
      setError(extractErrorMessage(authError, "Registration failed. Please try again."));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSignIn() {
    setError(null);
    setLoadingAction("signin");
    try {
      const result = await AppRuntime.runPromise(
        AuthService.pipe(Effect.andThen((service) => service.signIn())),
      );
      if (!result.user) throw new Error("Sign-in completed without a user account.");
      await finishAuth(result.user.id);
    } catch (authError: unknown) {
      console.error("Sign-in failed:", authError);
      setError(extractErrorMessage(authError, "Sign-in failed. Please try again."));
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isLoading && onOpenChange(nextOpen)}>
      <DialogContent finalFocus={false} showCloseButton={!isLoading}>
        <DialogHeader>
          <DialogTitle>Keep the conversation going</DialogTitle>
          <DialogDescription className="flex flex-col gap-3">
            <span>
              Readmaxxing is an AI-assisted reading app with chat, search, notes, bookmarks, and
              reading history.
            </span>
            <span>
              Use it for syntopical reading, comparative literature, and interrogating multiple
              books at once. Sign in to chat and sync your library across devices.
            </span>
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {loadingAction === "setup" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            Setting up your library…
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={isLoading} />}>
            Keep reading
          </DialogClose>
          <Button variant="outline" disabled={isLoading} onClick={handleSignIn}>
            {loadingAction === "signin" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
          <Button disabled={isLoading} onClick={handleRegister}>
            {loadingAction === "register" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
