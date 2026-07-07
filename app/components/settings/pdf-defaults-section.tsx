import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
        <span className="text-sm text-muted-foreground">Layout</span>
        <Select
          value={settings.pdfLayout}
          onValueChange={(value) => {
            if (value !== null) updateSettings({ pdfLayout: value as PdfLayout });
          }}
        >
          <SelectTrigger aria-label="PDF layout" className="w-56 max-sm:w-full">
            <SelectValue placeholder="Select layout" />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectGroup>
              {pdfLayoutOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
