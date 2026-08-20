import type { Collection } from "@augmentcode/themis/utils/collections/collection-utils";

import type { Bookmark } from "~/lib/stores/bookmark-store";

export interface BookmarksState {
  collection: Collection<Bookmark, "id">;
  errorsByBookId: Record<string, string>;
}
