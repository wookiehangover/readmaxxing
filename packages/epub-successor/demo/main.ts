import type { ContentTransform } from "../src/content-pipeline/content-pipeline";
import { createDecorationLayer, type DecorationLayer } from "../src/decorations/decorations";
import { openPublication } from "../src/epub-parser/publication";
import type { PersistentLocator } from "../src/locations/locations";
import {
  createNavigator,
  type Navigator,
  type NavigatorPreferences,
  type Relocation,
} from "../src/navigator/navigator";
import { createPretextMeasurementExperiment } from "../src/pretext-layout/canvas-engine";
import {
  logPretextErrorReport,
  measurePretextErrors,
  PretextExperimentGate,
} from "../src/pretext-layout/measurement-harness";
import type { PretextTypography } from "../src/pretext-layout/pretext-layout";
import type { TocEntry } from "../src/publication-model/publication-model";
import { normalizePublicationPath } from "../src/publication-model/paths";
import {
  openZipResourceProvider,
  type ZipResourceProvider,
} from "../src/resource-loader/resource-loader";
import { ResourceUrlManager } from "../src/resource-loader/urls";
import { createDemoTestApi } from "./test-api";
import { securityTransform, stressTransform } from "./transforms";

const FIXTURES = [
  "minimal-epub3.epub",
  "minimal-epub2.epub",
  "rtl.epub",
  "embedded-font.epub",
  "nested-paths.epub",
  "duplicate-spine.epub",
  "images.epub",
  "script-content.epub",
  "external-references.epub",
  "meta-refresh.epub",
] as const;

function element<T extends Element>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing demo element: ${selector}`);
  return match;
}

const reader = element<HTMLDivElement>("#reader");
const fixtureSelect = element<HTMLSelectElement>("#fixture");
const flowSelect = element<HTMLSelectElement>("#flow");
const spreadSelect = element<HTMLSelectElement>("#spread");
const themeSelect = element<HTMLSelectElement>("#theme");
const statusOutput = element<HTMLOutputElement>("#status");
const relocationOutput = element<HTMLOutputElement>("#relocation");
const highlightButton = element<HTMLButtonElement>("#highlight");
const pretextReport = element<HTMLElement>("#pretext-report");
const parameters = new URLSearchParams(location.search);
const testMode = parameters.has("test");
const forceOverlay = parameters.get("overlay") === "1";
const addStressContent = parameters.get("stress") === "1";
const addSecurityProbes = parameters.get("securityProbe") === "1";
const pretextGate = new PretextExperimentGate();
const pretextExperiment =
  parameters.get("pretext") === "1" ? createPretextMeasurementExperiment() : undefined;
pretextGate.setEnabled(pretextExperiment !== undefined);

for (const fixture of FIXTURES) fixtureSelect.add(new Option(fixture, fixture));
fixtureSelect.value = parameters.get("fixture") ?? "minimal-epub3.epub";
flowSelect.value = parameters.get("flow") ?? "scrolled";
spreadSelect.value = parameters.get("spread") ?? "single";

const urlLifecycle = { created: [] as string[], revoked: [] as string[] };
if (testMode) {
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = create(object);
    urlLifecycle.created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    urlLifecycle.revoked.push(url);
    revoke(url);
  };
}

let provider: ZipResourceProvider | undefined;
let urlManager: ResourceUrlManager | undefined;
let navigator: Navigator | undefined;
let decorations: DecorationLayer | undefined;
let relocation: Relocation | undefined;
let selectedLocator: PersistentLocator | null = null;
let selectedText = "";
let decorationClicks = 0;
let relocationCount = 0;
let settleRafCycles = 0;
const stateEvents: string[] = [];
let preferences: NavigatorPreferences = {
  flow: flowSelect.value as "scrolled" | "paginated",
  spread: spreadSelect.value as "single" | "double",
  theme: "light",
  fontSize: 100,
  lineHeight: 1.5,
  margins: 24,
};

function transforms(): readonly ContentTransform[] {
  return [
    ...(addStressContent ? [stressTransform] : []),
    ...(addSecurityProbes ? [securityTransform] : []),
  ];
}

function pixelValue(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function typography(doc: Document): PretextTypography {
  const sample = doc.querySelector("p") ?? doc.body ?? doc.documentElement;
  const style = doc.defaultView?.getComputedStyle(sample);
  const fontSizePx = pixelValue(style?.fontSize, 16);
  return {
    fontFamily: style?.fontFamily || "serif",
    fontSizePx,
    lineHeightPx: pixelValue(style?.lineHeight, fontSizePx * 1.2),
    fontStyle:
      style?.fontStyle === "italic" || style?.fontStyle === "oblique" ? style.fontStyle : "normal",
    fontWeight: style?.fontWeight || "normal",
    letterSpacingPx: pixelValue(style?.letterSpacing, 0),
    whiteSpace: style?.whiteSpace === "pre-wrap" ? "pre-wrap" : "normal",
    wordBreak: style?.wordBreak === "keep-all" ? "keep-all" : "normal",
  };
}

function renderPretextReport(): void {
  const doc = navigator?.contentDocument;
  if (!doc || !pretextExperiment || !pretextGate.active) return;
  const report = measurePretextErrors(doc, pretextExperiment, {
    gate: pretextGate,
    typography: typography(doc),
  });
  logPretextErrorReport(report);
  const summary = document.createElement("p");
  summary.textContent = `${report.summary.measuredCount} measured, ${report.summary.skippedCount} skipped`;
  const table = document.createElement("table");
  const headings = ["Paragraph", "Predicted px", "Actual px", "Error px", "Error %"];
  const header = table.createTHead().insertRow();
  for (const heading of headings) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = heading;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const measurement of report.measurements) {
    const row = body.insertRow();
    for (const value of [
      measurement.elementId ?? measurement.blockId,
      measurement.predictedHeightPx,
      measurement.actualHeightPx,
      measurement.absoluteErrorPx,
      measurement.percentageError,
    ]) {
      row.insertCell().textContent = typeof value === "number" ? value.toFixed(2) : (value ?? "—");
    }
  }
  pretextReport.dataset.state = report.state;
  pretextReport.hidden = false;
  pretextReport.replaceChildren(summary, table);
}

async function cleanup(): Promise<void> {
  decorations?.destroy();
  decorations = undefined;
  navigator?.destroy();
  navigator = undefined;
  await Promise.resolve();
  urlManager?.dispose();
  urlManager = undefined;
  provider?.close();
  provider = undefined;
  reader.replaceChildren();
  pretextReport.hidden = true;
  pretextReport.replaceChildren();
}

function renderToc(entries: readonly TocEntry[], list = element<HTMLOListElement>("#toc")): void {
  list.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.title;
    button.addEventListener("click", () => void displayHref(entry.href));
    item.append(button);
    if (entry.children.length > 0) {
      const children = document.createElement("ol");
      item.append(children);
      renderToc(entry.children, children);
    }
    list.append(item);
  }
}

function observeNavigator(nextNavigator: Navigator): void {
  nextNavigator.addEventListener("statechange", (event) => {
    const state = (event as CustomEvent<string>).detail;
    stateEvents.push(state);
    statusOutput.value = state;
    if (state !== "settling") return;
    const view = nextNavigator.contentDocument?.defaultView;
    view?.requestAnimationFrame(() =>
      view.requestAnimationFrame(() => {
        settleRafCycles += 1;
      }),
    );
  });
  nextNavigator.addEventListener("relocation", (event) => {
    relocation = (event as CustomEvent<Relocation>).detail;
    relocationCount += 1;
    relocationOutput.value = JSON.stringify(relocation);
  });
}

function configureDecorations(): void {
  if (!navigator?.contentDocument || !relocation) return;
  decorations?.destroy();
  selectedLocator = null;
  selectedText = "";
  highlightButton.disabled = true;
  const link = navigator.publication.readingOrder[relocation.spineIndex];
  decorations = createDecorationLayer({
    document: navigator.contentDocument,
    section: {
      href: relocation.href,
      spineIndex: relocation.spineIndex,
      spineLength: navigator.publication.readingOrder.length,
      mediaType: link?.mediaType,
      title: link?.title,
    },
    rendering: forceOverlay ? "overlay" : "auto",
  });
  decorations.on("selection-changed", (detail) => {
    selectedLocator = detail.locator;
    selectedText = detail.text;
    highlightButton.disabled = detail.locator === null;
  });
  decorations.on("decoration-click", () => {
    decorationClicks += 1;
  });
  renderPretextReport();
}

async function loadSource(source: Blob, label: string): Promise<void> {
  statusOutput.value = `Opening ${label}`;
  await cleanup();
  const nextProvider = await openZipResourceProvider(source);
  const result = await openPublication(nextProvider);
  if (!result.publication) {
    nextProvider.close();
    throw new Error(result.diagnostics.map(({ message }) => message).join("; "));
  }
  provider = nextProvider;
  urlManager = new ResourceUrlManager(provider);
  navigator = createNavigator(result.publication, {
    container: reader,
    preferences,
    security: {
      resourceProvider: provider,
      resourceUrlManager: urlManager,
      transforms: transforms(),
    },
  });
  observeNavigator(navigator);
  renderToc(result.publication.toc);
  relocation = await navigator.display({ spineIndex: 0 });
  configureDecorations();
  statusOutput.value = `Opened ${result.publication.metadata.title}`;
}

async function loadFixture(name: string): Promise<void> {
  fixtureSelect.value = name;
  const response = await fetch(`/fixtures/${name}`);
  if (!response.ok) throw new Error(`Fixture request failed: ${response.status}`);
  await loadSource(await response.blob(), name);
}

async function displayHref(href: string): Promise<void> {
  if (!navigator) return;
  relocation = await navigator.display({ href: normalizePublicationPath(href) });
  configureDecorations();
}

async function move(direction: "next" | "previous"): Promise<boolean> {
  if (!navigator) return false;
  const before = navigator.contentDocument;
  const moved = await navigator[direction]();
  if (moved && before !== navigator.contentDocument) configureDecorations();
  return moved;
}

async function updatePreferences(update: NavigatorPreferences): Promise<void> {
  preferences = { ...preferences, ...update };
  await navigator?.setPreferences(update);
  decorations?.refresh();
  renderPretextReport();
}

function addHighlight(): boolean {
  if (!selectedLocator || !decorations) return false;
  decorations.clear();
  return decorations.add({
    id: "demo-highlight",
    locator: selectedLocator,
    style: { variant: "highlight", color: "rgba(250, 204, 21, 0.55)" },
  });
}

window.__epubDemo = createDemoTestApi({
  reader,
  lifecycle: urlLifecycle,
  navigator: () => navigator,
  decorations: () => decorations,
  relocation: () => relocation,
  selectedText: () => selectedText,
  decorationClicks: () => decorationClicks,
  relocationCount: () => relocationCount,
  settleRafCycles: () => settleRafCycles,
  stateEvents: () => stateEvents,
  load: loadFixture,
  unload: cleanup,
  move,
  displayHref,
  setPreferences: updatePreferences,
  addHighlight,
  configureDecorations,
});

function reportFailure(cause: unknown): void {
  statusOutput.value = cause instanceof Error ? cause.message : String(cause);
}

element<HTMLButtonElement>("#open-fixture").addEventListener(
  "click",
  () => void loadFixture(fixtureSelect.value).catch(reportFailure),
);
element<HTMLInputElement>("#file").addEventListener("change", (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (file) void loadSource(file, file.name).catch(reportFailure);
});
element<HTMLButtonElement>("#previous").addEventListener(
  "click",
  () => void move("previous").catch(reportFailure),
);
element<HTMLButtonElement>("#next").addEventListener(
  "click",
  () => void move("next").catch(reportFailure),
);
highlightButton.addEventListener("click", addHighlight);
flowSelect.addEventListener(
  "change",
  () =>
    void updatePreferences({ flow: flowSelect.value as "scrolled" | "paginated" }).catch(
      reportFailure,
    ),
);
spreadSelect.addEventListener(
  "change",
  () =>
    void updatePreferences({ spread: spreadSelect.value as "single" | "double" }).catch(
      reportFailure,
    ),
);
themeSelect.addEventListener(
  "change",
  () =>
    void updatePreferences({ theme: themeSelect.value as "light" | "dark" | "sepia" }).catch(
      reportFailure,
    ),
);
element<HTMLInputElement>("#font-size").addEventListener(
  "input",
  (event) =>
    void updatePreferences({
      fontSize: Number((event.currentTarget as HTMLInputElement).value),
    }).catch(reportFailure),
);
element<HTMLInputElement>("#line-height").addEventListener(
  "input",
  (event) =>
    void updatePreferences({
      lineHeight: Number((event.currentTarget as HTMLInputElement).value),
    }).catch(reportFailure),
);
element<HTMLInputElement>("#margins").addEventListener(
  "input",
  (event) =>
    void updatePreferences({
      margins: Number((event.currentTarget as HTMLInputElement).value),
    }).catch(reportFailure),
);

void loadFixture(fixtureSelect.value).catch(reportFailure);
