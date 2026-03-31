import { Fragment } from "react";
import { MoreHorizontal, Minus, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { ReaderLayout, PdfLayout, Settings } from "~/lib/settings";

interface ReaderSettingsMenuProps {
  settings: Settings;
  onUpdateSettings: (update: Partial<Settings>) => void;
  isPdf?: boolean;
}

const layoutOptions: { value: ReaderLayout; label: string }[] = [
  { value: "single", label: "Single Page" },
  { value: "spread", label: "Two Page Spread" },
  { value: "scroll", label: "Continuous Scroll" },
];

const pdfLayoutOptions: { value: PdfLayout; label: string }[] = [
  { value: "original", label: "Original Size" },
  { value: "fit-height", label: "Fit to Height" },
  { value: "fit-width", label: "Fit to Width" },
  { value: "two-page", label: "Two Page" },
  { value: "continuous", label: "Continuous" },
];

const fontSections = [
  {
    label: "Serif",
    options: [
      { value: "Literata", label: "Literata" },
      { value: "Merriweather", label: "Merriweather" },
      { value: "Lora", label: "Lora" },
      { value: "Source Serif 4", label: "Source Serif 4" },
    ],
  },
  {
    label: "Sans-serif",
    options: [
      { value: "Geist", label: "Geist" },
      { value: "Inter", label: "Inter" },
    ],
  },
  {
    label: "Monospace",
    options: [
      { value: "Geist Mono", label: "Geist Mono" },
      { value: "Berkeley Mono", label: "Berkeley Mono" },
    ],
  },
] as const;

export function ReaderSettingsMenu({ settings, onUpdateSettings, isPdf }: ReaderSettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-9 w-9 items-center justify-center rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground">
        <MoreHorizontal className="size-4" />
        <span className="sr-only">Reader settings</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Layout</DropdownMenuLabel>
          {isPdf ? (
            <DropdownMenuRadioGroup
              value={settings.pdfLayout}
              onValueChange={(value) => onUpdateSettings({ pdfLayout: value as PdfLayout })}
            >
              {pdfLayoutOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          ) : (
            <DropdownMenuRadioGroup
              value={settings.readerLayout}
              onValueChange={(value) => onUpdateSettings({ readerLayout: value as ReaderLayout })}
            >
              {layoutOptions.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuGroup>

        {!isPdf && <DropdownMenuSeparator />}

        {!isPdf && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Font: {settings.fontFamily}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {fontSections.map((section, index) => (
                <Fragment key={section.label}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={settings.fontFamily}
                      onValueChange={(value) => onUpdateSettings({ fontFamily: value as string })}
                    >
                      {section.options.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </Fragment>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {!isPdf && <DropdownMenuSeparator />}

        {!isPdf && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Size &amp; Spacing</DropdownMenuLabel>
            <DropdownMenuItem closeOnClick={false} className="flex items-center justify-between">
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
                <span className="w-10 text-center text-sm tabular-nums">{settings.fontSize}%</span>
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
            </DropdownMenuItem>
            <DropdownMenuItem closeOnClick={false} className="flex items-center justify-between">
              <span className="text-sm">Spacing</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    onUpdateSettings({
                      lineHeight: Math.max(1.0, Math.round((settings.lineHeight - 0.1) * 10) / 10),
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
                      lineHeight: Math.min(2.5, Math.round((settings.lineHeight + 0.1) * 10) / 10),
                    })
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
                  aria-label="Increase line height"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
