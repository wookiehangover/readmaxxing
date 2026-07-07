import { Minus, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";

export function StepperControl({
  label,
  displayValue,
  onDecrement,
  onIncrement,
}: {
  label: string;
  displayValue: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onDecrement}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus />
        </Button>
        <span className="w-12 text-center text-sm tabular-nums">{displayValue}</span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={onIncrement}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}
