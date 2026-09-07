import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Layers, LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { useSettings } from "~/lib/settings";

const VIEWS = [
  { value: "grid", label: "Grid view", icon: LayoutGrid },
  { value: "table", label: "Table view", icon: Rows3 },
  { value: "stack", label: "Stack view", icon: Layers },
] as const;

export function LibraryViewToggle() {
  const [settings, updateSettings] = useSettings();

  return (
    <ToggleGroup
      aria-label="Library layout"
      className="flex items-center"
      value={[settings.libraryView]}
      onValueChange={(values) => {
        const value = values[0];
        if (value === "grid" || value === "table" || value === "stack") {
          updateSettings({ libraryView: value });
        }
      }}
    >
      {VIEWS.map(({ value, label, icon: Icon }) => (
        <Toggle
          key={value}
          value={value}
          aria-label={label}
          title={label}
          render={
            <Button
              size="icon-sm"
              variant={settings.libraryView === value ? "secondary" : "ghost"}
            />
          }
        >
          <Icon aria-hidden="true" />
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
