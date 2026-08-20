import { useState } from "react";
import { redirect, useNavigate, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import type { Route } from "./+types/login";
import { Button } from "~/components/ui/button";
import { authService } from "~/lib/auth-service";
import { useAuth } from "~/lib/context/auth-context";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Log in — Readmaxxing" }];
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "cause" in err) {
    const cause = err.cause;
    if (cause instanceof Error) return cause.message;
    if (typeof cause === "string") return cause;
  }
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}

export async function clientLoader() {
  const session = await authService.getSession();
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
  const [searchParams] = useSearchParams();
  const { refreshAuth, register, signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"register" | "signin" | null>(null);

  async function handleRegister() {
    setError(null);
    setLoadingAction("register");
    try {
      await register("Reader");
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
      await signIn();
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
  const magicLinkError =
    searchParams.get("error") === "magic_link"
      ? "That magic link has expired or is invalid. Sign in below."
      : null;
  const displayedError = error ?? magicLinkError;

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

        {displayedError && (
          <p className="text-center text-sm text-destructive" role="alert">
            {displayedError}
          </p>
        )}
      </div>
    </div>
  );
}
