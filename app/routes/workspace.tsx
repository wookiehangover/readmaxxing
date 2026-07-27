import { useEffect, type FunctionComponent } from "react";
import { DockviewReact, type DockviewTheme, type IDockviewPanelProps } from "dockview-react";
import { useOutletContext } from "react-router";
import type { AppFrameOutletContext } from "~/routes/app-frame";
import { BookmarksPanel } from "~/components/workspace/bookmarks-panel";
import { LeftHeaderActions } from "~/components/workspace/left-header-actions";
import { NewTabPanel } from "~/components/workspace/new-tab-panel";
import { BookReaderPanel, ChatPanel, NotebookPanel } from "~/components/workspace/panel-components";
import { ReadingHistoryPanel } from "~/components/workspace/reading-history-panel";
import { StandardEbooksPanel } from "~/components/workspace/standard-ebooks-panel";
import { WatermarkPanel } from "~/components/workspace/watermark-panel";

const components: Record<string, FunctionComponent<IDockviewPanelProps<any>>> = {
  "book-reader": BookReaderPanel,
  notebook: NotebookPanel,
  "new-tab": NewTabPanel,
  "standard-ebooks": StandardEbooksPanel,
  chat: ChatPanel,
  bookmarks: BookmarksPanel,
  "reading-history": ReadingHistoryPanel,
};

const dockviewTheme: DockviewTheme = {
  name: "app",
  className: "dockview-theme-app",
};

export default function WorkspaceRoute() {
  const { onDockviewReady, onDockviewDispose } = useOutletContext<AppFrameOutletContext>();

  useEffect(() => onDockviewDispose, [onDockviewDispose]);

  return (
    <DockviewReact
      theme={dockviewTheme}
      components={components}
      watermarkComponent={WatermarkPanel}
      leftHeaderActionsComponent={LeftHeaderActions}
      onReady={onDockviewReady}
      disableDnd
      disableFloatingGroups
    />
  );
}
