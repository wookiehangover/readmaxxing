import { Link } from "react-router";
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

export function OnboardingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={false}>
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
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep reading</DialogClose>
          <Button render={<Link to="/login" />} nativeButton={false}>
            Sign in / Create account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
