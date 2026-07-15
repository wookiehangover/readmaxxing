import { useState } from "react";
import { Effect } from "effect";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import { AuthService } from "~/lib/auth-service";
import { useAuth } from "~/lib/context/auth-context";
import { AppRuntime } from "~/lib/effect-runtime";

export function AccountSection() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [magicLinkUrl, setMagicLinkUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleGenerate() {
    setIsGenerating(true);
    setMagicLinkUrl(null);
    try {
      const result = await AppRuntime.runPromise(
        AuthService.pipe(Effect.andThen((service) => service.generateMagicLink())),
      );
      setMagicLinkUrl(result.url);
    } catch (cause) {
      console.error("Failed to generate magic link:", cause);
      toast.error("Could not generate magic link");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopy() {
    if (!magicLinkUrl) return;
    try {
      await navigator.clipboard.writeText(magicLinkUrl);
      toast.success("Magic link copied");
    } catch {
      toast.error("Could not copy magic link");
    }
  }

  if (isAuthLoading) {
    return <StateMessage>Checking sign-in status…</StateMessage>;
  }

  if (!isAuthenticated) {
    return (
      <section className="flex flex-col items-start gap-4">
        <StateMessage>Sign in to generate a magic link.</StateMessage>
        <Link
          to="/login"
          className="inline-flex text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div className="max-w-md">
          <span className="block text-sm font-medium text-foreground">Magic link</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a temporary link for signing in on another device.
          </p>
        </div>
        <Button
          onClick={() => void handleGenerate()}
          disabled={isGenerating}
          className="max-sm:w-full"
        >
          {isGenerating
            ? "Generating…"
            : magicLinkUrl
              ? "Regenerate magic link"
              : "Generate magic link"}
        </Button>
      </div>

      {magicLinkUrl && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
              <Input aria-label="Magic link" readOnly value={magicLinkUrl} />
              <Button variant="outline" onClick={() => void handleCopy()}>
                Copy
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Expires in 15 minutes. Anyone with this link can sign in to your account until then.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
