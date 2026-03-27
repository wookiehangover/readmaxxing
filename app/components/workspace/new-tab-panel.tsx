import type { IDockviewPanelProps } from "dockview";
import { LibraryBrowseContent } from "~/components/workspace/library-browse-content";

export function NewTabPanel(_props: IDockviewPanelProps<Record<string, never>>) {
  return <LibraryBrowseContent />;
}
