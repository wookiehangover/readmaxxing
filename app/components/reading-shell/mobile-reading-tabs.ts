export const MOBILE_READING_TAB_EVENT = "reading-shell:open-mobile-tab";

export type MobileReadingTab = "Read" | "Notes" | "Discuss" | "Outline";

export function openMobileReadingTab(tab: MobileReadingTab) {
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent<MobileReadingTab>(MOBILE_READING_TAB_EVENT, { detail: tab }),
    );
  });
}
