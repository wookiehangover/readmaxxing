import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

import type { TaggedError } from "~/lib/errors";
import type { FocusedWorkspaceCluster } from "~/lib/stores/workspace-store";

export interface FocusedWorkspaceRestoreSnapshot {
  order: string[];
  activeBookId: string | null;
  clusters: Collection<FocusedWorkspaceCluster, "bookId">;
}

export interface WorkspaceRestoreState {
  lastOpenedByBookId: Record<string, number>;
  focusedWorkspace: FocusedWorkspaceRestoreSnapshot | null;
  loading: boolean;
  error: TaggedError | null;
}
