import { COLOR_THEME_IDS, COLOR_THEMES } from "~/lib/color-themes";
import { useSettings, type Theme } from "~/lib/settings";
import { cn } from "~/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSection() {
  const [settings, updateSettings] = useSettings();

  return (
    <section className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <span className="text-sm font-medium text-foreground">Theme</span>
        <Select
          items={themeOptions}
          value={settings.theme}
          onValueChange={(value) => {
            if (value !== null) updateSettings({ theme: value as Theme });
          }}
        >
          <SelectTrigger aria-label="Theme" className="w-56 max-sm:w-full">
            <SelectValue placeholder="Select theme" />
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectGroup>
              {themeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div>
        <span className="mb-4 block text-sm font-medium text-foreground">Color Theme</span>
        <div className="flex flex-wrap gap-3">
          {COLOR_THEME_IDS.map((id) => {
            const theme = COLOR_THEMES[id];
            const isSelected = settings.colorTheme === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => updateSettings({ colorTheme: id })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors",
                  {
                    "ring-2 ring-primary ring-offset-2 ring-offset-background": isSelected,
                    "hover:bg-accent/50": !isSelected,
                  },
                )}
              >
                <div className="flex overflow-hidden border">
                  {theme.swatchColors.map((color) => (
                    <div
                      key={`${id}-${color}`}
                      className="size-4"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">{theme.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
