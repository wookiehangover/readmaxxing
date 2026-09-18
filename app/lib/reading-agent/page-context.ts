export const MAX_ADJACENT_PAGE_TEXT_LENGTH = 12_000;

/** Keep the portion closest to the current page when context exceeds the bound. */
export function boundAdjacentPageText(
  text: string | null | undefined,
  side: "previous" | "next",
): string | null {
  const normalized = text?.normalize("NFC").trim();
  if (!normalized) return null;
  return side === "previous"
    ? normalized.slice(-MAX_ADJACENT_PAGE_TEXT_LENGTH)
    : normalized.slice(0, MAX_ADJACENT_PAGE_TEXT_LENGTH);
}
