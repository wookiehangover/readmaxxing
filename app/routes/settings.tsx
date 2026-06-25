import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "lucide-react";
import { AppearanceSection } from "~/components/settings/appearance-section";
import { PdfDefaultsSection } from "~/components/settings/pdf-defaults-section";
import { ReaderDefaultsSection } from "~/components/settings/reader-defaults-section";
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

type SettingsSectionId = "appearance" | "reader" | "pdf" | "updates";

const sectionGroups: {
  label: string;
  items: { id: SettingsSectionId; label: string; description: string }[];
}[] = [
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", description: "Theme and colors" },
      { id: "reader", label: "Reader Defaults", description: "Books and typography" },
      { id: "pdf", label: "PDF Defaults", description: "PDF layout" },
    ],
  },
  {
    label: "App",
    items: [{ id: "updates", label: "Updates", description: "Version checks" }],
  },
];

function renderSection(section: SettingsSectionId) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "reader":
      return <ReaderDefaultsSection />;
    case "pdf":
      return <PdfDefaultsSection />;
    case "updates":
      return <UpdatesSection />;
  }
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col md:flex-row">
        <aside className="flex shrink-0 flex-col border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:sticky md:top-0 md:h-dvh md:w-64 md:border-r md:border-b-0 md:px-5">
          <Link
            to="/"
            className="inline-flex w-fit items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to app
          </Link>

          <div className="mt-6">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Customize your reading workspace.</p>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {sectionGroups.map((group) => (
              <div key={group.label} className="contents md:block">
                <p className="hidden px-2 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block">
                  {group.label}
                </p>
                <div className="contents md:flex md:flex-col md:gap-1 md:pb-5">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveSection(item.id)}
                      className={cn(
                        "shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full",
                        {
                          "bg-accent text-foreground shadow-sm": activeSection === item.id,
                          "text-muted-foreground hover:bg-accent/60 hover:text-foreground":
                            activeSection !== item.id,
                        },
                      )}
                    >
                      <span className="block font-medium">{item.label}</span>
                      <span className="hidden text-xs text-muted-foreground md:block">
                        {item.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <SettingsFooter />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:h-dvh md:px-8 md:py-10">
          <div className="mx-auto max-w-3xl">{renderSection(activeSection)}</div>
        </main>
      </div>
    </div>
  );
}
