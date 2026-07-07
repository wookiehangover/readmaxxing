import { StepperControl } from "~/components/settings/controls";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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

export function ReaderDefaultsControls() {
  const [settings, updateSettings] = useSettings();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <span className="text-sm font-medium text-foreground">Layout</span>
        <Select
          value={settings.readerLayout}
          onValueChange={(value) => {
            if (value !== null) updateSettings({ readerLayout: value as ReaderLayout });
          }}
        >
          <SelectTrigger aria-label="Reader layout" className="w-56 max-sm:w-full">
            <SelectValue placeholder="Select layout" />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectGroup>
              {layoutOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <span className="text-sm font-medium text-foreground">Font</span>
          <Select
            value={settings.fontFamily}
            onValueChange={(value) => {
              if (value !== null) updateSettings({ fontFamily: value });
            }}
          >
            <SelectTrigger aria-label="Reader font" className="w-56 max-sm:w-full">
              <SelectValue placeholder="Select font" />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              {fontSections.map((section) => (
                <SelectGroup key={section.label}>
                  <SelectLabel>{section.label}</SelectLabel>
                  {section.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

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
    </div>
  );
}
