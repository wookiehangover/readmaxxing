import { useState } from "react";
import { useSearchParams } from "react-router";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "~/components/ui/card";
import { parseCliCallback, sendCliCallback } from "~/lib/cli-login-callback";

export function meta() {
  return [{ title: "Connect CLI — Readmaxxing" }, { name: "referrer", content: "no-referrer" }];
}

export default function CliRoute() {
  const [params] = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "ready" | "authorizing" | "connecting" | "connected" | "manual"
  >("ready");
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = status === "authorizing" || status === "connecting";

  async function authorize() {
    setStatus("authorizing");
    setError(null);
    setNeedsLogin(false);
    try {
      const response = await fetch("/api/auth/cli", { method: "POST" });
      if (response.status === 401) {
        setNeedsLogin(true);
        setStatus("ready");
        return;
      }
      if (!response.ok) throw new Error("Could not connect. Try again.");
      const credential = await response.json();
      if (typeof credential.token !== "string") throw new Error("Could not connect. Try again.");
      setToken(credential.token);
      const callback = parseCliCallback(params);
      if (callback) {
        setStatus("connecting");
        try {
          await sendCliCallback(callback, credential.token);
          setToken(null);
          setStatus("connected");
          return;
        } catch {
          /* Show the same credential for manual login if localhost is unreachable. */
        }
      }
      setStatus("manual");
    } catch (cause) {
      setStatus("ready");
      setError(cause instanceof Error ? cause.message : "Could not connect. Try again.");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>{status === "connected" ? "CLI connected" : "Connect CLI"}</h1>
          </CardTitle>
          <CardDescription>
            {status === "connected"
              ? "You can close this tab."
              : status === "manual"
                ? "Paste this token into your terminal."
                : needsLogin
                  ? "Sign in, then return here to connect."
                  : "Allow the CLI to access your account."}
          </CardDescription>
        </CardHeader>
        {status !== "connected" && (
          <CardContent className="flex flex-col gap-4">
            {status === "manual" && token ? (
              <>
                <code className="break-all select-all rounded-md bg-muted p-3">{token}</code>
                <Button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(token);
                      setCopied(true);
                    } catch {
                      setError("Select and copy the token above.");
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy token"}
                </Button>
              </>
            ) : (
              <>
                {needsLogin && (
                  <a
                    className={buttonVariants({ variant: "outline" })}
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Sign in
                  </a>
                )}
                <Button disabled={pending} onClick={authorize}>
                  {pending ? "Connecting…" : "Connect"}
                </Button>
              </>
            )}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </CardContent>
        )}
      </Card>
    </main>
  );
}
