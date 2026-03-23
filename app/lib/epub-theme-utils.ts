/**
 * Shared utilities for epub theme color resolution.
 *
 * CSS variables in this project use oklch() color format, which may not be
 * supported inside the epub iframe context. This module resolves theme colors
 * to rgb() strings by letting the browser compute the final value.
 */

/**
 * Resolve the `--background` and `--foreground` CSS variable values for the
 * given color mode, returning browser-computed rgb strings that are safe to
 * inject into an epub iframe.
 *
 * A temporary DOM element is used so that `getComputedStyle` returns the
 * resolved rgb value rather than the raw oklch() variable value.
 */
export function resolveThemeColors(mode: "light" | "dark") {
  const root = document.documentElement;
  const currentlyDark = root.classList.contains("dark");
  const needsDark = mode === "dark";

  // Temporarily toggle dark class if necessary so CSS variables resolve
  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", needsDark);
  }

  // Create a temporary element that uses the CSS variables as actual color
  // properties. getComputedStyle on these properties returns the browser-
  // resolved rgb() value, even when the variable is defined in oklch().
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.backgroundColor = "var(--background)";
  probe.style.color = "var(--foreground)";
  document.body.appendChild(probe);

  // Force style recalculation before reading computed values
  probe.offsetHeight;

  const computed = getComputedStyle(probe);
  const background = computed.backgroundColor;
  const foreground = computed.color;

  document.body.removeChild(probe);

  // Restore original dark class state
  if (needsDark !== currentlyDark) {
    root.classList.toggle("dark", currentlyDark);
  }

  return { background, foreground };
}

