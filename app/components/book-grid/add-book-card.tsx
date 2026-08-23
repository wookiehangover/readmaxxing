import { Plus } from "lucide-react";

export function AddBookCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex aspect-[2/3] w-full flex-col items-center justify-center bg-muted/20 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/50"
    >
      <span className="flex gap-1 items-center">
        <Plus className="size-4" />
        <span className="text-xs">Upload</span>
      </span>
    </button>
  );
}
