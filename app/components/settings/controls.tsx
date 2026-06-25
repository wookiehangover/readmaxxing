import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-md border px-3 py-1.5 text-sm transition-colors", {
        "border-primary bg-primary text-primary-foreground": selected,
        "border-border bg-card hover:bg-accent": !selected,
      })}
    >
      {children}
    </button>
  );
}

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
      <span className="text-sm text-muted-foreground">{label}</span>
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
