import { COLOR_THEME_IDS, COLOR_THEMES } from "~/lib/color-themes";
import { useSettings, type Theme } from "~/lib/settings";
import { cn } from "~/lib/utils";
import { OptionButton } from "~/components/settings/controls";
import { Separator } from "~/components/ui/separator";

const themeOptions: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function AppearanceSection() {
  const [settings, updateSettings] = useSettings();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <span className="text-sm font-medium">Theme</span>
        <div className="flex flex-wrap gap-1.5">
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

      <Separator />

      <div>
        <span className="mb-3 block text-sm font-medium">Color Theme</span>
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
