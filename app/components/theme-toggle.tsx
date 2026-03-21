import { useEffect } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useSettings, resolveTheme, type Theme } from "~/lib/settings";

const themeOrder: Theme[] = ["system", "light", "dark"];

function nextTheme(current: Theme): Theme {
  const idx = themeOrder.indexOf(current);
  return themeOrder[(idx + 1) % themeOrder.length];
}

function ThemeIcon({ theme }: { theme: Theme }) {
  switch (theme) {
    case "light":
      return <Sun className="size-4" />;
    case "dark":
      return <Moon className="size-4" />;
    case "system":
      return <Monitor className="size-4" />;
  }
}

export function ThemeToggle() {
  const [settings, updateSettings] = useSettings();

  // Apply theme class to <html> whenever settings change
  useEffect(() => {
    const resolved = resolveTheme(settings.theme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [settings.theme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.classList.toggle("dark", mq.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [settings.theme]);

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => updateSettings({ theme: nextTheme(settings.theme) })}
        aria-label={`Theme: ${settings.theme}. Click to change.`}
      >
        <ThemeIcon theme={settings.theme} />
      </Button>
    </div>
  );
}
