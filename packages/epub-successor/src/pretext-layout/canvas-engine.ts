import { PretextMeasurementExperiment } from "./pretext-layout";
import type {
  TextMeasurementEngine,
  TextMeasurementLayout,
  TextMeasurementPrepareOptions,
} from "./pretext-layout";

export type CanvasTextMeasure = (text: string, font: string) => number;

interface PreparedUnit {
  readonly width: number;
  readonly graphemeWidths: readonly number[];
  readonly whitespace: boolean;
}

interface PreparedLine {
  readonly units: readonly PreparedUnit[];
}

interface CanvasPreparedText {
  readonly engine: "canvas-greedy";
  readonly lines: readonly PreparedLine[];
  readonly preserveWhitespace: boolean;
}

let sharedContext: CanvasRenderingContext2D | null = null;

function browserMeasureText(text: string, font: string): number {
  if (typeof document === "undefined") {
    throw new Error("Canvas text measurement requires a browser document");
  }
  if (sharedContext === null) {
    sharedContext = document.createElement("canvas").getContext("2d");
  }
  if (sharedContext === null) throw new Error("Canvas 2D text measurement is unavailable");
  sharedContext.font = font;
  return sharedContext.measureText(text).width;
}

function graphemes(text: string): readonly string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return [...segmenter.segment(text)].map(({ segment }) => segment);
}

function prepareUnit(
  text: string,
  font: string,
  letterSpacing: number,
  measureText: CanvasTextMeasure,
): PreparedUnit {
  const parts = graphemes(text);
  return {
    width: measureText(text, font) + Math.max(0, parts.length - 1) * letterSpacing,
    graphemeWidths: parts.map(
      (part, index) => measureText(part, font) + (index < parts.length - 1 ? letterSpacing : 0),
    ),
    whitespace: /^\s+$/.test(text),
  };
}

function prepareLine(
  text: string,
  font: string,
  letterSpacing: number,
  measureText: CanvasTextMeasure,
): PreparedLine {
  const tokens = text.split(/(\s+)/).filter((token) => token.length > 0);
  return {
    units: tokens.map((token) => prepareUnit(token, font, letterSpacing, measureText)),
  };
}

function addWidths(
  widths: readonly number[],
  maximumWidth: number,
  state: { lineCount: number; lineWidth: number },
): void {
  for (const width of widths) {
    if (state.lineWidth > 0 && state.lineWidth + width > maximumWidth) {
      state.lineCount += 1;
      state.lineWidth = 0;
    }
    state.lineWidth += width;
  }
}

function layoutLine(line: PreparedLine, maximumWidth: number, preserveWhitespace: boolean): number {
  if (line.units.length === 0) return preserveWhitespace ? 1 : 0;
  const state = { lineCount: 1, lineWidth: 0 };
  let pendingWhitespace: PreparedUnit | null = null;

  for (const unit of line.units) {
    if (unit.whitespace && !preserveWhitespace) {
      if (state.lineWidth > 0) pendingWhitespace = unit;
      continue;
    }
    if (unit.whitespace) {
      addWidths(unit.graphemeWidths, maximumWidth, state);
      continue;
    }

    const gapWidth = pendingWhitespace?.width ?? 0;
    if (state.lineWidth > 0 && state.lineWidth + gapWidth + unit.width > maximumWidth) {
      state.lineCount += 1;
      state.lineWidth = 0;
    } else if (state.lineWidth > 0) {
      state.lineWidth += gapWidth;
    }
    pendingWhitespace = null;

    if (unit.width <= maximumWidth) {
      state.lineWidth += unit.width;
    } else {
      addWidths(unit.graphemeWidths, maximumWidth, state);
    }
  }
  return state.lineCount;
}

function isPreparedText(value: unknown): value is CanvasPreparedText {
  return (
    typeof value === "object" &&
    value !== null &&
    "engine" in value &&
    value.engine === "canvas-greedy"
  );
}

export function createCanvasTextMeasurementEngine(
  measureText: CanvasTextMeasure = browserMeasureText,
): TextMeasurementEngine {
  return {
    prepare(
      text: string,
      font: string,
      options: TextMeasurementPrepareOptions,
    ): CanvasPreparedText {
      const preserveWhitespace = options.whiteSpace === "pre-wrap";
      const normalized = preserveWhitespace
        ? text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
        : text.trim().replace(/\s+/g, " ");
      const sourceLines = preserveWhitespace ? normalized.split("\n") : [normalized];
      return {
        engine: "canvas-greedy",
        lines: sourceLines.map((line) =>
          prepareLine(line, font, options.letterSpacing ?? 0, measureText),
        ),
        preserveWhitespace,
      };
    },
    layout(prepared: unknown, width: number, lineHeight: number): TextMeasurementLayout {
      if (!isPreparedText(prepared)) throw new TypeError("Expected canvas-prepared text");
      const lineCount = prepared.lines.reduce(
        (total, line) => total + layoutLine(line, width, prepared.preserveWhitespace),
        0,
      );
      return { lineCount, height: lineCount * lineHeight };
    },
  };
}

export function createPretextMeasurementExperiment(
  measureText?: CanvasTextMeasure,
): PretextMeasurementExperiment {
  return new PretextMeasurementExperiment(createCanvasTextMeasurementEngine(measureText));
}
