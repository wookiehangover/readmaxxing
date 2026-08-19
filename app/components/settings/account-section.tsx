import { useEffect, useState } from "react";
import { Link } from "react-router";
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
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import type { AuthPasskey, MagicLinkResponse } from "~/lib/auth-service";
import { useAuth } from "~/lib/context/auth-context";

export function AccountSection() {
  const {
    isAuthenticated,
    isLoading: isAuthLoading,
    listPasskeys,
    addPasskey,
    renamePasskey,
    removePasskey,
    generateMagicLink,
  } = useAuth();
  const [passkeys, setPasskeys] = useState<AuthPasskey[]>([]);
  const [isLoadingPasskeys, setIsLoadingPasskeys] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [passkeyToRemove, setPasskeyToRemove] = useState<AuthPasskey | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<MagicLinkResponse | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const minutesUntilExpiry = magicLink
    ? Math.max(1, Math.round((new Date(magicLink.expiresAt).getTime() - Date.now()) / 60_000))
    : null;

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    setIsLoadingPasskeys(true);

    listPasskeys()
      .then((loadedPasskeys) => {
        if (active) setPasskeys(loadedPasskeys);
      })
      .catch((cause) => {
        console.error("Failed to load passkeys:", cause);
        toast.error("Could not load passkeys");
      })
      .finally(() => {
        if (active) setIsLoadingPasskeys(false);
      });

    return () => {
      active = false;
    };
  }, [isAuthenticated, listPasskeys]);

  async function handleAddPasskey() {
    setIsAdding(true);
    try {
      await addPasskey();
      setPasskeys(await listPasskeys());
      toast.success("Passkey added");
    } catch (cause) {
      console.error("Failed to add passkey:", cause);
      toast.error(getAuthErrorMessage(cause, "Could not add passkey"));
    } finally {
      setIsAdding(false);
    }
  }

  function startRenaming(passkey: AuthPasskey) {
    setEditingId(passkey.id);
    setNameDraft(passkey.name ?? "");
  }

  async function handleRename(event: React.FormEvent, passkey: AuthPasskey) {
    event.preventDefault();
    const name = nameDraft.trim() || null;
    setIsRenaming(true);
    try {
      await renamePasskey(passkey.id, name);
      setPasskeys((current) =>
        current.map((item) => (item.id === passkey.id ? { ...item, name } : item)),
      );
      setEditingId(null);
      toast.success("Passkey renamed");
    } catch (cause) {
      console.error("Failed to rename passkey:", cause);
      toast.error(getAuthErrorMessage(cause, "Could not rename passkey"));
    } finally {
      setIsRenaming(false);
    }
  }

  async function handleRemovePasskey() {
    if (!passkeyToRemove) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await removePasskey(passkeyToRemove.id);
      setPasskeys((current) => current.filter((item) => item.id !== passkeyToRemove.id));
      setPasskeyToRemove(null);
      toast.success("Passkey removed");
    } catch (cause) {
      console.error("Failed to remove passkey:", cause);
      setRemoveError(getRemoveErrorMessage(cause));
    } finally {
      setIsRemoving(false);
    }
  }

  async function handleGenerate() {
    setIsGenerating(true);
    setMagicLink(null);
    try {
      const result = await generateMagicLink();
      setMagicLink(result);
    } catch (cause) {
      console.error("Failed to generate magic link:", cause);
      toast.error("Could not generate magic link");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleCopy() {
    if (!magicLink) return;
    try {
      await navigator.clipboard.writeText(magicLink.url);
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
          <span className="block text-sm font-medium text-foreground">Passkeys</span>
          <p className="mt-1 text-sm text-muted-foreground">
            Add passkeys for the devices you use to sign in.
          </p>
        </div>
        <Button
          onClick={() => void handleAddPasskey()}
          disabled={isAdding}
          className="max-sm:w-full"
        >
          {isAdding ? "Adding…" : "Add passkey"}
        </Button>
      </div>

      {isLoadingPasskeys ? (
        <StateMessage>Loading passkeys…</StateMessage>
      ) : passkeys.length === 0 ? (
        <StateMessage>No passkeys found.</StateMessage>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Passkey</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {passkeys.map((passkey) => (
              <TableRow key={passkey.id}>
                <TableCell className="min-w-52 font-medium">
                  {editingId === passkey.id ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(event) => void handleRename(event, passkey)}
                    >
                      <Input
                        aria-label="Passkey name"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        disabled={isRenaming}
                      />
                      <Button type="submit" size="sm" disabled={isRenaming}>
                        {isRenaming ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isRenaming}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    passkey.name || "Passkey"
                  )}
                </TableCell>
                <TableCell>
                  <time dateTime={passkey.createdAt}>{formatCreatedAt(passkey.createdAt)}</time>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startRenaming(passkey)}
                      disabled={editingId !== null}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setRemoveError(null);
                        setPasskeyToRemove(passkey);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={passkeyToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !isRemoving) {
            setPasskeyToRemove(null);
            setRemoveError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove passkey?</DialogTitle>
            <DialogDescription>
              This device will no longer be able to use this passkey to sign in.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p className="text-sm text-destructive" role="alert">
              {removeError}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={isRemoving} />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleRemovePasskey()}
              disabled={isRemoving}
            >
              {isRemoving ? "Removing…" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

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
            : magicLink
              ? "Regenerate magic link"
              : "Generate magic link"}
        </Button>
      </div>

      {magicLink && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 max-sm:flex-col max-sm:items-stretch">
              <Input aria-label="Magic link" readOnly value={magicLink.url} />
              <Button variant="outline" onClick={() => void handleCopy()}>
                Copy
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Expires in {minutesUntilExpiry} minute{minutesUntilExpiry === 1 ? "" : "s"}. Anyone
              with this link can sign in to your account until then.
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

function formatCreatedAt(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function getAuthErrorMessage(cause: unknown, fallback: string) {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "cause" in cause &&
    cause.cause instanceof Error
  ) {
    return cause.cause.message;
  }
  return fallback;
}

function getRemoveErrorMessage(cause: unknown) {
  const message = getAuthErrorMessage(cause, "Could not remove passkey");
  return message === "Cannot remove the last passkey"
    ? "Add another passkey before removing your last passkey."
    : message;
}
