import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import { Cause, Effect, Runtime } from "effect";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { AuthService } from "~/lib/auth-service";
import { useAuth } from "~/lib/context/auth-context";
import { AppRuntime } from "~/lib/effect-runtime";

/**
 * Extract the real error message from Effect's FiberFailure wrapper.
 *
 * When `AppRuntime.runPromise` rejects, the thrown value is a FiberFailure
 * whose `.message` is the generic "An error has occurred". The actual error
 * is buried inside the Cause chain. This walks that chain to surface the
 * original message (e.g. from a DOMException thrown by the WebAuthn API).
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  // Effect FiberFailure — dig into the Cause to find our AuthError
  if (err instanceof Error && Runtime.FiberFailureCauseId in err) {
    const cause = (err as any)[Runtime.FiberFailureCauseId];
    if (cause) {
      const failures = Array.from(Cause.failures(cause));
      if (failures.length > 0) {
        const authErr = failures[0];
        // AuthError has a 'cause' field holding the original error
        if (authErr && typeof authErr === "object" && "cause" in authErr) {
          const original = (authErr as any).cause;
          if (original instanceof Error) return original.message;
          if (typeof original === "string") return original;
        }
        // Fallback to the AuthError's own message
        if (authErr instanceof Error) return authErr.message;
      }
    }
  }
  // Simple nested cause (non-Effect errors)
  if (err instanceof Error && err.cause instanceof Error) {
    return err.cause.message;
  }
  if (err instanceof Error && err.message && err.message !== "An error has occurred") {
    return err.message;
  }
  if (typeof err === "string") return err;
  return fallback;
}

export async function clientLoader() {
  const session = await AppRuntime.runPromise(
    AuthService.pipe(Effect.andThen((s) => s.getSession())),
  );
  if (session.user) {
    throw redirect("/");
  }
  return {};
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading…</p>
    </div>
  );
}

export default function LoginRoute() {
  const navigate = useNavigate();
  const { refreshAuth } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"register" | "signin" | null>(null);

  async function handleRegister() {
    setError(null);
    setLoadingAction("register");
    try {
      await AppRuntime.runPromise(AuthService.pipe(Effect.andThen((s) => s.register("Reader"))));
      refreshAuth();
      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (err instanceof Response) return;
      console.error("Register failed:", err);
      setError(extractErrorMessage(err, "Registration failed. Please try again."));
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSignIn() {
    setError(null);
    setLoadingAction("signin");
    try {
      await AppRuntime.runPromise(AuthService.pipe(Effect.andThen((s) => s.signIn())));
      refreshAuth();
      navigate("/", { replace: true });
    } catch (err: unknown) {
      if (err instanceof Response) return;
      console.error("Sign-in failed:", err);
      setError(extractErrorMessage(err, "Sign-in failed. Please try again."));
    } finally {
      setLoadingAction(null);
    }
  }

  const isLoading = loadingAction !== null;

  return (
    <div className="flex h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Readmaxxing</h1>
          <p className="text-sm text-muted-foreground">Sign in with a passkey to get started.</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button size="lg" disabled={isLoading} onClick={handleRegister}>
            {loadingAction === "register" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>
          <Button variant="outline" size="lg" disabled={isLoading} onClick={handleSignIn}>
            {loadingAction === "signin" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </div>

        {error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
