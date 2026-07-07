import { OptionButton } from "~/components/settings/controls";
import { useSettings, type PdfLayout } from "~/lib/settings";

const pdfLayoutOptions: { value: PdfLayout; label: string }[] = [
  { value: "original", label: "Original Size" },
  { value: "fit-height", label: "Fit to Height" },
  { value: "fit-width", label: "Fit to Width" },
  { value: "two-page", label: "Two Page" },
  { value: "continuous", label: "Continuous" },
];

export function PdfDefaultsControls() {
  const [settings, updateSettings] = useSettings();

  return (
    <div>
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <span className="text-sm font-medium">Layout</span>
        <div className="flex flex-wrap gap-1.5">
          {pdfLayoutOptions.map((opt) => (
            <OptionButton
              key={opt.value}
              selected={settings.pdfLayout === opt.value}
              onClick={() => updateSettings({ pdfLayout: opt.value })}
            >
              {opt.label}
            </OptionButton>
          ))}
        </div>
      </div>
    </div>
  );
}
