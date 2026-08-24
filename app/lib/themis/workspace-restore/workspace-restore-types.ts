import type { TaggedError } from "~/lib/errors";

export interface WorkspaceRestoreState {
  lastOpenedByBookId: Record<string, number>;
  loading: boolean;
  error: TaggedError | null;
}
