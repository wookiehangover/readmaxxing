import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { AppearanceSection } from "~/components/settings/appearance-section";
import { BugReportsSection } from "~/components/settings/bug-reports-section";
import { ReadingSection } from "~/components/settings/reading-section";
import { SettingsFooter } from "~/components/settings/settings-footer";
import { UpdatesSection } from "~/components/settings/updates-section";
import { cn } from "~/lib/utils";

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

type SettingsSectionId = "appearance" | "reading" | "bug-reports" | "updates";

const sections: { id: SettingsSectionId; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "reading", label: "Reading" },
  { id: "bug-reports", label: "Bug reports" },
  { id: "updates", label: "Updates" },
];

function renderSection(section: SettingsSectionId) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "reading":
      return <ReadingSection />;
    case "bug-reports":
      return <BugReportsSection />;
    case "updates":
      return <UpdatesSection />;
  }
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const activeSectionLabel =
    sections.find((item) => item.id === activeSection)?.label ?? "Settings";

  return (
    <div className="min-h-dvh bg-background">
      <div className="flex min-h-dvh w-full flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b bg-sidebar px-4 py-4 md:sticky md:top-0 md:h-dvh md:w-64 md:border-r md:border-b-0 md:px-5">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Home
          </Link>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full",
                  {
                    "bg-sidebar-foreground/10 text-sidebar-foreground": activeSection === item.id,
                    "text-muted-foreground hover:bg-accent/60 hover:text-foreground":
                      activeSection !== item.id,
                  },
                )}
              >
                <span className="block font-medium">{item.label}</span>
              </button>
            ))}
          </nav>

          <SettingsFooter />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:h-dvh md:px-8 md:py-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-8">
            <h1 className="text-xl font-semibold tracking-tight">{activeSectionLabel}</h1>
            {renderSection(activeSection)}
          </div>
        </main>
      </div>
    </div>
  );
}
