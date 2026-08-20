import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

import type { TaggedError } from "~/lib/errors";
import type { Bookmark } from "~/lib/stores/bookmark-store";

export interface BookmarksState {
  collection: Collection<Bookmark, "id">;
  loadingBookIds: string[];
  loadedBookIds: string[];
  errorsByBookId: Record<string, TaggedError>;
}
