import {
  type PretextBlock,
  type PretextMeasurementExperiment,
  type PretextTypography,
} from "./pretext-layout";

export type IneligibilityReason =
  | "empty"
  | "float"
  | "image"
  | "markup"
  | "mathml"
  | "not-paragraph"
  | "ruby"
  | "table";

export interface ParagraphCandidate {
  readonly tagName: string;
  readonly text: string;
  readonly hasFloat?: boolean;
  readonly hasImage?: boolean;
  readonly hasMarkup?: boolean;
  readonly hasMathMl?: boolean;
  readonly hasRuby?: boolean;
  readonly hasTable?: boolean;
}

export interface ParagraphEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly IneligibilityReason[];
}

export function paragraphEligibility(candidate: ParagraphCandidate): ParagraphEligibility {
  const reasons: IneligibilityReason[] = [];
  if (candidate.tagName.toLowerCase() !== "p") reasons.push("not-paragraph");
  if (candidate.text.trim().length === 0) reasons.push("empty");
  if (candidate.hasImage) reasons.push("image");
  if (candidate.hasTable) reasons.push("table");
  if (candidate.hasRuby) reasons.push("ruby");
  if (candidate.hasMathMl) reasons.push("mathml");
  if (candidate.hasFloat) reasons.push("float");
  if (candidate.hasMarkup) reasons.push("markup");
  return { eligible: reasons.length === 0, reasons };
}

export class PretextExperimentGate {
  #enabled: boolean;
  #killed: boolean;

  constructor(options: { readonly enabled?: boolean; readonly killed?: boolean } = {}) {
    this.#enabled = options.enabled ?? false;
    this.#killed = options.killed ?? false;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get killed(): boolean {
    return this.#killed;
  }

  get active(): boolean {
    return this.#enabled && !this.#killed;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  kill(): void {
    this.#killed = true;
  }

  resetKillSwitch(): void {
    this.#killed = false;
  }
}

export interface PretextErrorMeasurement {
  readonly blockId: string;
  readonly elementId: string | null;
  readonly predictedHeightPx: number;
  readonly actualHeightPx: number;
  readonly absoluteErrorPx: number;
  readonly percentageError: number | null;
}

export interface PretextErrorSummary {
  readonly measuredCount: number;
  readonly skippedCount: number;
  readonly meanAbsoluteErrorPx: number;
  readonly maximumAbsoluteErrorPx: number;
  readonly meanPercentageError: number | null;
}

export interface PretextErrorReport {
  readonly state: "disabled" | "killed" | "measured";
  readonly measurements: readonly PretextErrorMeasurement[];
  readonly summary: PretextErrorSummary;
}

export interface ParagraphContentBox {
  readonly width: number;
  readonly height: number;
}

export interface MeasurePretextErrorsOptions {
  readonly gate: PretextExperimentGate;
  readonly typography: PretextTypography;
  readonly readContentBox?: (element: HTMLParagraphElement) => ParagraphContentBox;
}

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function contentBox(element: HTMLParagraphElement): ParagraphContentBox {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  if (!view) return { width: rect.width, height: rect.height };
  const style = view.getComputedStyle(element);
  const horizontal =
    pixelValue(style.paddingLeft) +
    pixelValue(style.paddingRight) +
    pixelValue(style.borderLeftWidth) +
    pixelValue(style.borderRightWidth);
  const vertical =
    pixelValue(style.paddingTop) +
    pixelValue(style.paddingBottom) +
    pixelValue(style.borderTopWidth) +
    pixelValue(style.borderBottomWidth);
  return {
    width: Math.max(0, rect.width - horizontal),
    height: Math.max(0, rect.height - vertical),
  };
}

function hasFloat(element: HTMLParagraphElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  return [element, ...element.querySelectorAll<HTMLElement>("*")].some((descendant) => {
    const value = view.getComputedStyle(descendant).cssFloat;
    return value.length > 0 && value !== "none";
  });
}

function candidateFor(element: HTMLParagraphElement): ParagraphCandidate {
  return {
    tagName: element.localName,
    text: element.textContent ?? "",
    hasFloat: hasFloat(element),
    hasImage: element.querySelector("img") !== null,
    hasMarkup: element.childElementCount > 0,
    hasMathMl: element.querySelector("math") !== null,
    hasRuby: element.querySelector("ruby") !== null,
    hasTable: element.querySelector("table") !== null,
  };
}

function emptyReport(state: "disabled" | "killed"): PretextErrorReport {
  return {
    state,
    measurements: [],
    summary: {
      measuredCount: 0,
      skippedCount: 0,
      meanAbsoluteErrorPx: 0,
      maximumAbsoluteErrorPx: 0,
      meanPercentageError: null,
    },
  };
}

export function measurePretextErrors(
  root: ParentNode,
  experiment: PretextMeasurementExperiment,
  options: MeasurePretextErrorsOptions,
): PretextErrorReport {
  if (options.gate.killed) return emptyReport("killed");
  if (!options.gate.enabled) return emptyReport("disabled");

  const paragraphs = [...root.querySelectorAll<HTMLParagraphElement>("p")];
  const eligible = paragraphs.flatMap((element, index) => {
    const candidate = candidateFor(element);
    if (!paragraphEligibility(candidate).eligible) return [];
    const block: PretextBlock = { id: `paragraph-${index + 1}`, text: candidate.text };
    return [{ block, element }];
  });
  const prepared = experiment.prepare(
    eligible.map(({ block }) => block),
    options.typography,
  );
  const measurements = eligible.map(({ block, element }) => {
    const box = (options.readContentBox ?? contentBox)(element);
    const prediction = prepared.predictBlockHeight(block.id, box.width);
    const absoluteErrorPx = Math.abs(prediction.height - box.height);
    return {
      blockId: block.id,
      elementId: element.id || null,
      predictedHeightPx: prediction.height,
      actualHeightPx: box.height,
      absoluteErrorPx,
      percentageError: box.height === 0 ? null : (absoluteErrorPx / box.height) * 100,
    };
  });
  const percentageErrors = measurements.flatMap(({ percentageError }) =>
    percentageError === null ? [] : [percentageError],
  );
  const absoluteErrorTotal = measurements.reduce(
    (total, measurement) => total + measurement.absoluteErrorPx,
    0,
  );
  return {
    state: "measured",
    measurements,
    summary: {
      measuredCount: measurements.length,
      skippedCount: paragraphs.length - measurements.length,
      meanAbsoluteErrorPx: measurements.length === 0 ? 0 : absoluteErrorTotal / measurements.length,
      maximumAbsoluteErrorPx: Math.max(
        0,
        ...measurements.map(({ absoluteErrorPx }) => absoluteErrorPx),
      ),
      meanPercentageError:
        percentageErrors.length === 0
          ? null
          : percentageErrors.reduce((total, error) => total + error, 0) / percentageErrors.length,
    },
  };
}

export interface PretextReportLogger {
  info(message: string): void;
  table(data?: unknown): void;
}

export function logPretextErrorReport(
  report: PretextErrorReport,
  logger: PretextReportLogger = console,
): void {
  logger.info(
    `[pretext-layout] ${report.state}: ${report.summary.measuredCount} measured, ${report.summary.skippedCount} skipped`,
  );
  if (report.state === "measured") logger.table(report.measurements);
}
