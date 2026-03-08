import { MoreHorizontal, Check, Minus, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import type { ReaderLayout, Settings } from "~/lib/settings";

interface ReaderSettingsMenuProps {
  settings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
}

const layoutOptions: { value: ReaderLayout; label: string }[] = [
  { value: "single", label: "Single Page" },
  { value: "spread", label: "Two Page Spread" },
  { value: "scroll", label: "Continuous Scroll" },
];

const fontOptions = [
  { value: "Literata", label: "Literata" },
  { value: "Merriweather", label: "Merriweather" },
  { value: "Inter", label: "Inter" },
  { value: "Lora", label: "Lora" },
  { value: "Source Serif 4", label: "Source Serif 4" },
  { value: "Geist", label: "Geist" },
  { value: "Geist Mono", label: "Geist Mono" },
];

export function ReaderSettingsMenu({
  settings,
  onUpdateSettings,
}: ReaderSettingsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <MoreHorizontal className="size-4" />
        <span className="sr-only">Reader settings</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Layout
        </div>
        {layoutOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onUpdateSettings({ readerLayout: option.value })}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="w-4">
              {settings.readerLayout === option.value && (
                <Check className="size-4" />
              )}
            </span>
            {option.label}
          </button>
        ))}

        <div className="my-0.5 border-t" />

        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Font
        </div>
        {fontOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onUpdateSettings({ fontFamily: option.value })}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="w-4">
              {settings.fontFamily === option.value && (
                <Check className="size-4" />
              )}
            </span>
            <span style={{ fontFamily: `"${option.value}", ${option.value === "Geist" ? "sans-serif" : option.value === "Geist Mono" ? "monospace" : "serif"}` }}>
              {option.label}
            </span>
          </button>
        ))}

        <div className="my-0.5 border-t" />

        <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
          Size & Spacing
        </div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-sm">Size</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.max(75, settings.fontSize - 5),
                })
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              aria-label="Decrease font size"
            >
              <Minus className="size-3" />
            </button>
            <span className="w-10 text-center text-sm tabular-nums">
              {settings.fontSize}%
            </span>
            <button
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.min(200, settings.fontSize + 5),
                })
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              aria-label="Increase font size"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-sm">Spacing</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                onUpdateSettings({
                  lineHeight: Math.max(
                    1.0,
                    Math.round((settings.lineHeight - 0.1) * 10) / 10,
                  ),
                })
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              aria-label="Decrease line height"
            >
              <Minus className="size-3" />
            </button>
            <span className="w-10 text-center text-sm tabular-nums">
              {settings.lineHeight.toFixed(1)}
            </span>
            <button
              onClick={() =>
                onUpdateSettings({
                  lineHeight: Math.min(
                    2.5,
                    Math.round((settings.lineHeight + 0.1) * 10) / 10,
                  ),
                })
              }
              className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
              aria-label="Increase line height"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

