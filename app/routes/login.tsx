import { useState } from "react";
import { useNavigate } from "react-router";
import { Effect } from "effect";
import { Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { AuthService } from "~/lib/auth-service";
import { AppRuntime } from "~/lib/effect-runtime";

export async function clientLoader() {
  const isAuthed = await AppRuntime.runPromise(
    AuthService.pipe(Effect.andThen((s) => s.isAuthenticated())),
  );
  if (isAuthed) {
    throw new Response(null, { status: 302, headers: { Location: "/" } });
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
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"register" | "signin" | null>(null);

  async function handleRegister() {
    setError(null);
    setLoadingAction("register");
    try {
      await AppRuntime.runPromise(AuthService.pipe(Effect.andThen((s) => s.register("Reader"))));
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setLoadingAction(null);
    }
  }

  async function handleSignIn() {
    setError(null);
    setLoadingAction("signin");
    try {
      await AppRuntime.runPromise(AuthService.pipe(Effect.andThen((s) => s.signIn())));
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
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
