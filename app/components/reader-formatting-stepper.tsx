import { Minus, Plus } from "lucide-react";
import { DropdownMenuItem } from "~/components/ui/dropdown-menu";

export function ReaderFormattingStepper({
  label,
  action,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  action: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <DropdownMenuItem closeOnClick={false} className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onDecrease}
          className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"
          aria-label={`Decrease ${action}`}
        >
          <Minus className="size-3" />
        </button>
        <span className="w-10 text-center text-sm tabular-nums">{value}</span>
        <button
          type="button"
          onClick={onIncrease}
          className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"
          aria-label={`Increase ${action}`}
        >
          <Plus className="size-3" />
        </button>
      </div>
    </DropdownMenuItem>
  );
}
