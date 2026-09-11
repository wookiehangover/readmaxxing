import { useState } from "react";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "~/components/ui/card";

export function meta() {
  return [{ title: "Connect the CLI — Readmaxxing" }, { name: "referrer", content: "no-referrer" }];
}

export default function CliRoute() {
  const [credential, setCredential] = useState<{ token: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [copied, setCopied] = useState(false);

  async function authorize() {
    setPending(true);
    setError(null);
    setNeedsLogin(false);
    try {
      const response = await fetch("/api/auth/cli", { method: "POST" });
      if (response.status === 401) {
        setNeedsLogin(true);
        return;
      }
      if (!response.ok) throw new Error("Could not connect the CLI. Please try again.");
      setCredential(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect the CLI.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            <h1>Connect the Readmaxxing CLI</h1>
          </CardTitle>
          <CardDescription>
            Upload books and download your library, notes, outlines, and conversations from your
            terminal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {credential ? (
            <>
              <p>
                Paste this token into the waiting <code>readmaxxing login</code> prompt. Keep it
                private: it grants access to your account.
              </p>
              <code className="break-all select-all rounded-md bg-muted p-3">
                {credential.token}
              </code>
              <p className="text-sm text-muted-foreground">
                Expires {new Date(credential.expiresAt).toLocaleDateString()}. Run{" "}
                <code>readmaxxing logout</code> to revoke it.
              </p>
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(credential.token);
                    setCopied(true);
                  } catch {
                    setError("Copy the token above manually.");
                  }
                }}
              >
                {copied ? "Copied" : "Copy token"}
              </Button>
            </>
          ) : (
            <>
              <p>
                Authorize a separate CLI session for 30 days. Your browser stays signed in when you
                log out of the CLI.
              </p>
              {needsLogin && (
                <p>Sign in in the new tab, then return here and select Authorize CLI.</p>
              )}
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
                {pending ? "Authorizing…" : "Authorize CLI"}
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            The CLI accesses synced data. Sync browser changes before exporting.
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
