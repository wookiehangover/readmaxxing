export const READING_RAIL_TABS = [
  "Read",
  "Notes",
  "Discuss",
  "Outline",
  "Details",
  "Review",
] as const;
export type ReadingRailTab = (typeof READING_RAIL_TABS)[number];
export interface ReadingRailState {
  detailsOwner: string | null;
  selections: Record<string, ReadingRailTab>;
}
