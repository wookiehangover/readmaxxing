export const MOBILE_READING_TAB_EVENT = "reading-shell:open-mobile-tab";

export const MOBILE_READING_TABS = ["Read", "Notes", "Discuss", "Outline"] as const;

export type MobileReadingTab = (typeof MOBILE_READING_TABS)[number] | "Details";
const mobileTabStorageKeyPrefix = "reading-shell:mobile-tab:";

export function getRememberedMobileReadingTab(bookId: string | null) {
  if (!bookId) return null;
  const tab = window.sessionStorage.getItem(`${mobileTabStorageKeyPrefix}${bookId}`);
  return MOBILE_READING_TABS.find((candidate) => candidate === tab) ?? null;
}

export function rememberMobileReadingTab(bookId: string | null, tab: MobileReadingTab) {
  if (bookId && tab !== "Details")
    window.sessionStorage.setItem(`${mobileTabStorageKeyPrefix}${bookId}`, tab);
}

export function openMobileReadingTab(tab: MobileReadingTab, bookId: string | null = null) {
  rememberMobileReadingTab(bookId, tab);
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent<MobileReadingTab>(MOBILE_READING_TAB_EVENT, { detail: tab }),
    );
  });
}
