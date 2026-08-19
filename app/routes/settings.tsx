import { useState } from "react";
import type { Route } from "./+types/settings";
import { AppNavigation } from "~/components/app-navigation";
import { DEFAULT_RAIL_WIDTH } from "~/components/reading-shell/reading-rail-width";
import { AccountSection } from "~/components/settings/account-section";
import { AppearanceSection } from "~/components/settings/appearance-section";
import { BugReportsSection } from "~/components/settings/bug-reports-section";
import { DataSection } from "~/components/settings/data-section";
import { ReadingSection } from "~/components/settings/reading-section";
import { SettingsFooter } from "~/components/settings/settings-footer";
import { UpdatesSection } from "~/components/settings/updates-section";
import { cn } from "~/lib/utils";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Settings — Readmaxxing" }];
}

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

type SettingsSectionId = "account" | "appearance" | "reading" | "bug-reports" | "updates" | "data";

const sections: { id: SettingsSectionId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
  { id: "reading", label: "Reading" },
  { id: "bug-reports", label: "Bug reports" },
  { id: "updates", label: "Updates" },
  { id: "data", label: "Data" },
];

function renderSection(section: SettingsSectionId) {
  switch (section) {
    case "account":
      return <AccountSection />;
    case "appearance":
      return <AppearanceSection />;
    case "reading":
      return <ReadingSection />;
    case "bug-reports":
      return <BugReportsSection />;
    case "updates":
      return <UpdatesSection />;
    case "data":
      return <DataSection />;
  }
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const activeSectionLabel =
    sections.find((item) => item.id === activeSection)?.label ?? "Settings";

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background">
      <header className="flex shrink-0 py-5">
        <div className="min-w-0 flex-1" />
        <AppNavigation />
      </header>
      <div data-slot="settings-layout" className="flex min-h-0 flex-1 flex-col md:flex-row">
        <main
          data-slot="settings-main"
          className="min-w-0 flex-1 overflow-y-auto px-4 pb-8 md:px-8"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-8">
            <h1 className="text-xl font-semibold tracking-tight">{activeSectionLabel}</h1>
            {renderSection(activeSection)}
          </div>
        </main>

        <aside
          data-slot="settings-rail"
          className="flex shrink-0 flex-col px-6 pb-6"
          style={{ width: DEFAULT_RAIL_WIDTH, maxWidth: "100%" }}
        >
          <nav aria-label="Settings sections" className="flex flex-col items-start gap-3">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                aria-pressed={activeSection === item.id}
                className={cn("text-left text-sm leading-5 transition-colors", {
                  "text-foreground": activeSection === item.id,
                  "text-muted-foreground hover:text-foreground": activeSection !== item.id,
                })}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <SettingsFooter />
        </aside>
      </div>
    </div>
  );
}
