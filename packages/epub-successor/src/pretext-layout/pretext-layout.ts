export interface PretextBlock {
  readonly id: string;
  readonly text: string;
}

export interface PretextTypography {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly fontStyle?: "normal" | "italic" | "oblique";
  readonly fontWeight?: number | string;
  readonly letterSpacingPx?: number;
  readonly whiteSpace?: "normal" | "pre-wrap";
  readonly wordBreak?: "normal" | "keep-all";
}

export interface TextMeasurementEngine {
  prepare(text: string, font: string, options: TextMeasurementPrepareOptions): unknown;
  layout(prepared: unknown, width: number, lineHeight: number): TextMeasurementLayout;
}

export interface TextMeasurementPrepareOptions {
  readonly letterSpacing?: number;
  readonly whiteSpace?: "normal" | "pre-wrap";
  readonly wordBreak?: "normal" | "keep-all";
}

export interface TextMeasurementLayout {
  readonly height: number;
  readonly lineCount: number;
}

export interface PredictedBlockHeight extends TextMeasurementLayout {
  readonly id: string;
  readonly approximate: true;
}

export interface PretextHeightPrediction {
  readonly width: number;
  readonly height: number;
  readonly blocks: readonly PredictedBlockHeight[];
  readonly approximate: true;
}

export interface PreparedPretextMeasurement {
  predictHeight(width: number): PretextHeightPrediction;
  predictBlockHeight(id: string, width: number): PredictedBlockHeight;
}

export interface PretextCacheStats {
  readonly entries: number;
  readonly preparations: number;
  readonly hits: number;
  readonly invalidations: number;
}

interface PreparedBlock {
  readonly id: string;
  readonly prepared: unknown;
}

function positiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

function typographyKey(typography: PretextTypography): string {
  positiveNumber(typography.fontSizePx, "fontSizePx");
  positiveNumber(typography.lineHeightPx, "lineHeightPx");
  if (typography.fontFamily.trim().length === 0)
    throw new TypeError("fontFamily must not be empty");
  if (typography.letterSpacingPx !== undefined && !Number.isFinite(typography.letterSpacingPx)) {
    throw new RangeError("letterSpacingPx must be finite");
  }
  return JSON.stringify([
    typography.fontFamily,
    typography.fontSizePx,
    typography.lineHeightPx,
    typography.fontStyle ?? "normal",
    typography.fontWeight ?? "normal",
    typography.letterSpacingPx ?? 0,
    typography.whiteSpace ?? "normal",
    typography.wordBreak ?? "normal",
  ]);
}

function fontShorthand(typography: PretextTypography): string {
  return `${typography.fontStyle ?? "normal"} ${typography.fontWeight ?? "normal"} ${typography.fontSizePx}px ${typography.fontFamily}`;
}

class PreparedMeasurement implements PreparedPretextMeasurement {
  readonly #blocks: readonly PreparedBlock[];
  readonly #blocksById: ReadonlyMap<string, PreparedBlock>;
  readonly #engine: TextMeasurementEngine;
  readonly #lineHeight: number;

  constructor(blocks: readonly PreparedBlock[], engine: TextMeasurementEngine, lineHeight: number) {
    this.#blocks = blocks;
    this.#blocksById = new Map(blocks.map((block) => [block.id, block]));
    this.#engine = engine;
    this.#lineHeight = lineHeight;
  }

  predictHeight(width: number): PretextHeightPrediction {
    positiveNumber(width, "width");
    const blocks = this.#blocks.map((block) => this.#predict(block, width));
    return {
      width,
      height: blocks.reduce((total, block) => total + block.height, 0),
      blocks,
      approximate: true,
    };
  }

  predictBlockHeight(id: string, width: number): PredictedBlockHeight {
    positiveNumber(width, "width");
    const block = this.#blocksById.get(id);
    if (!block) throw new RangeError(`Unknown prepared block: ${id}`);
    return this.#predict(block, width);
  }

  #predict(block: PreparedBlock, width: number): PredictedBlockHeight {
    const result = this.#engine.layout(block.prepared, width, this.#lineHeight);
    return { id: block.id, ...result, approximate: true };
  }
}

export class PretextMeasurementExperiment {
  readonly #engine: TextMeasurementEngine;
  readonly #cache = new Map<string, unknown>();
  #activeTypographyKey: string | null = null;
  #preparations = 0;
  #hits = 0;
  #invalidations = 0;

  constructor(engine: TextMeasurementEngine) {
    this.#engine = engine;
  }

  get cacheStats(): PretextCacheStats {
    return {
      entries: this.#cache.size,
      preparations: this.#preparations,
      hits: this.#hits,
      invalidations: this.#invalidations,
    };
  }

  prepare(
    blocks: readonly PretextBlock[],
    typography: PretextTypography,
  ): PreparedPretextMeasurement {
    const nextTypographyKey = typographyKey(typography);
    if (this.#activeTypographyKey !== null && this.#activeTypographyKey !== nextTypographyKey) {
      this.#cache.clear();
      this.#invalidations += 1;
    }
    this.#activeTypographyKey = nextTypographyKey;

    const ids = new Set<string>();
    const font = fontShorthand(typography);
    const options: TextMeasurementPrepareOptions = {
      letterSpacing: typography.letterSpacingPx,
      whiteSpace: typography.whiteSpace,
      wordBreak: typography.wordBreak,
    };
    const preparedBlocks = blocks.map((block) => {
      if (ids.has(block.id)) throw new TypeError(`Duplicate block id: ${block.id}`);
      ids.add(block.id);
      const cacheKey = JSON.stringify([nextTypographyKey, block.text]);
      let prepared = this.#cache.get(cacheKey);
      if (prepared === undefined) {
        prepared = this.#engine.prepare(block.text, font, options);
        this.#cache.set(cacheKey, prepared);
        this.#preparations += 1;
      } else {
        this.#hits += 1;
      }
      return { id: block.id, prepared };
    });
    return new PreparedMeasurement(preparedBlocks, this.#engine, typography.lineHeightPx);
  }

  clear(): void {
    if (this.#cache.size > 0) this.#invalidations += 1;
    this.#cache.clear();
    this.#activeTypographyKey = null;
  }
}
