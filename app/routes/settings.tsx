import { Link } from "react-router";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { useSettings, type Theme, type ReaderLayout } from "~/lib/settings";
import { Button } from "~/components/ui/button";

export async function clientLoader() {
  return {};
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return (
    <div className="flex h-dvh items-center justify-center">
      <p className="text-muted-foreground">Loading settings…</p>
    </div>
  );
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const layoutOptions: { value: ReaderLayout; label: string }[] = [
  { value: "single", label: "Single Page" },
  { value: "spread", label: "Two Page Spread" },
  { value: "scroll", label: "Continuous Scroll" },
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

function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

function StepperControl({
  label,
  value: _value,
  displayValue,
  onDecrement,
  onIncrement,
}: {
  label: string;
  value: number;
  displayValue: string;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={onDecrement}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="size-3" />
        </Button>
        <span className="w-12 text-center text-sm tabular-nums">{displayValue}</span>
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          onClick={onIncrement}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, updateSettings] = useSettings();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-12 max-w-2xl items-center gap-3 px-4">
          <Link
            to="/"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
        {/* Appearance */}
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Appearance
          </h2>
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Theme</span>
              <div className="flex gap-1.5">
                {themeOptions.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    selected={settings.theme === opt.value}
                    onClick={() => updateSettings({ theme: opt.value })}
                  >
                    {opt.label}
                  </OptionButton>
                ))}
              </div>
            </div>
          </div>
        </section>
        {/* Reader Defaults */}
        <section>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Reader Defaults
          </h2>
          <div className="space-y-4 rounded-lg border bg-card p-4">
            {/* Layout */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Layout</span>
              <div className="flex gap-1.5">
                {layoutOptions.map((opt) => (
                  <OptionButton
                    key={opt.value}
                    selected={settings.readerLayout === opt.value}
                    onClick={() => updateSettings({ readerLayout: opt.value })}
                  >
                    {opt.label}
                  </OptionButton>
                ))}
              </div>
            </div>

            <div className="border-t" />

            {/* Font */}
            <div>
              <span className="mb-2 block text-sm font-medium">Font</span>
              <div className="space-y-3">
                {fontSections.map((section) => (
                  <div key={section.label}>
                    <span className="mb-1 block text-xs text-muted-foreground">
                      {section.label}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {section.options.map((opt) => (
                        <OptionButton
                          key={opt.value}
                          selected={settings.fontFamily === opt.value}
                          onClick={() => updateSettings({ fontFamily: opt.value })}
                        >
                          {opt.label}
                        </OptionButton>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t" />

            {/* Font Size */}
            <StepperControl
              label="Font Size"
              value={settings.fontSize}
              displayValue={`${settings.fontSize}%`}
              onDecrement={() => updateSettings({ fontSize: Math.max(75, settings.fontSize - 5) })}
              onIncrement={() => updateSettings({ fontSize: Math.min(200, settings.fontSize + 5) })}
            />

            {/* Line Height */}
            <StepperControl
              label="Line Height"
              value={settings.lineHeight}
              displayValue={settings.lineHeight.toFixed(1)}
              onDecrement={() =>
                updateSettings({
                  lineHeight: Math.max(1.0, Math.round((settings.lineHeight - 0.1) * 10) / 10),
                })
              }
              onIncrement={() =>
                updateSettings({
                  lineHeight: Math.min(2.5, Math.round((settings.lineHeight + 0.1) * 10) / 10),
                })
              }
            />
          </div>
        </section>
      </main>
    </div>
  );
}
