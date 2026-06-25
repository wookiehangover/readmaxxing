import { OptionButton, StepperControl } from "~/components/settings/controls";
import { Separator } from "~/components/ui/separator";
import { useSettings, type ReaderLayout } from "~/lib/settings";

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

export function ReaderDefaultsSection() {
  const [settings, updateSettings] = useSettings();

  return (
    <section>
      <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Reader Defaults
      </h2>
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <span className="text-sm font-medium">Layout</span>
          <div className="flex flex-wrap gap-1.5">
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

        <Separator />

        <div>
          <span className="mb-2 block text-sm font-medium">Font</span>
          <div className="flex flex-col gap-3">
            {fontSections.map((section) => (
              <div key={section.label}>
                <span className="mb-1 block text-xs text-muted-foreground">{section.label}</span>
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

        <Separator />

        <StepperControl
          label="Font Size"
          displayValue={`${settings.fontSize}%`}
          onDecrement={() => updateSettings({ fontSize: Math.max(75, settings.fontSize - 5) })}
          onIncrement={() => updateSettings({ fontSize: Math.min(200, settings.fontSize + 5) })}
        />

        <StepperControl
          label="Line Height"
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
  );
}
