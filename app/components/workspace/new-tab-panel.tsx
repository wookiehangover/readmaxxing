import type { IDockviewPanelProps } from "dockview";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";

export function NewTabPanel({ api }: IDockviewPanelProps<Record<string, never>>) {
  return <LibraryBrowseContent panelApi={api} />;
}
