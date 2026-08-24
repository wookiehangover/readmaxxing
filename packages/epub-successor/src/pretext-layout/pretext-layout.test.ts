import { describe, expect, it, vi } from "vitest";

import { createPretextMeasurementExperiment } from "./canvas-engine";
import {
  paragraphEligibility,
  PretextExperimentGate,
  measurePretextErrors,
} from "./measurement-harness";
import {
  PretextMeasurementExperiment,
  type PretextTypography,
  type TextMeasurementEngine,
} from "./pretext-layout";

const TYPOGRAPHY: PretextTypography = {
  fontFamily: "Literata",
  fontSizePx: 16,
  lineHeightPx: 20,
};

function fakeEngine(): TextMeasurementEngine & {
  prepare: ReturnType<typeof vi.fn>;
  layout: ReturnType<typeof vi.fn>;
} {
  return {
    prepare: vi.fn((text: string) => ({ text })),
    layout: vi.fn((_prepared: unknown, width: number, lineHeight: number) => ({
      height: width < 200 ? lineHeight * 2 : lineHeight,
      lineCount: width < 200 ? 2 : 1,
    })),
  };
}

describe("PretextMeasurementExperiment", () => {
  it("uses cached canvas widths for greedy predictions without measuring during layout", () => {
    const measureText = vi.fn((text: string) => text.length * 10);
    const experiment = createPretextMeasurementExperiment(measureText);
    const prepared = experiment.prepare([{ id: "one", text: "alpha beta gamma" }], TYPOGRAPHY);
    const preparationCalls = measureText.mock.calls.length;

    expect(prepared.predictHeight(100)).toMatchObject({ height: 40 });
    expect(prepared.predictHeight(50)).toMatchObject({ height: 60 });
    expect(measureText).toHaveBeenCalledTimes(preparationCalls);
  });

  it("prepares each text/font input once and reuses it across width predictions", () => {
    const engine = fakeEngine();
    const experiment = new PretextMeasurementExperiment(engine);
    const prepared = experiment.prepare(
      [
        { id: "one", text: "shared text" },
        { id: "two", text: "shared text" },
      ],
      TYPOGRAPHY,
    );

    expect(engine.prepare).toHaveBeenCalledOnce();
    expect(prepared.predictHeight(320)).toMatchObject({ height: 40, approximate: true });
    expect(prepared.predictHeight(160)).toMatchObject({ height: 80, approximate: true });
    expect(engine.prepare).toHaveBeenCalledOnce();
    expect(experiment.cacheStats).toEqual({
      entries: 1,
      preparations: 1,
      hits: 1,
      invalidations: 0,
    });
  });

  it("invalidates cached preparation when typography changes", () => {
    const engine = fakeEngine();
    const experiment = new PretextMeasurementExperiment(engine);
    experiment.prepare([{ id: "one", text: "same" }], TYPOGRAPHY);
    experiment.prepare([{ id: "two", text: "same" }], TYPOGRAPHY);
    experiment.prepare([{ id: "three", text: "same" }], {
      ...TYPOGRAPHY,
      lineHeightPx: 24,
    });

    expect(engine.prepare).toHaveBeenCalledTimes(2);
    expect(experiment.cacheStats).toEqual({
      entries: 1,
      preparations: 2,
      hits: 1,
      invalidations: 1,
    });
  });
});

describe("paragraph eligibility", () => {
  it("accepts only non-empty, plain paragraph text", () => {
    expect(paragraphEligibility({ tagName: "p", text: "Plain text" })).toEqual({
      eligible: true,
      reasons: [],
    });
    expect(paragraphEligibility({ tagName: "div", text: "Text" }).reasons).toContain(
      "not-paragraph",
    );
    expect(paragraphEligibility({ tagName: "p", text: " " }).reasons).toContain("empty");
  });

  it.each([
    ["image", { hasImage: true }],
    ["table", { hasTable: true }],
    ["ruby", { hasRuby: true }],
    ["mathml", { hasMathMl: true }],
    ["float", { hasFloat: true }],
    ["markup", { hasMarkup: true }],
  ] as const)("rejects %s content", (reason, feature) => {
    expect(paragraphEligibility({ tagName: "p", text: "Text", ...feature }).reasons).toContain(
      reason,
    );
  });
});

describe("Pretext DOM error harness", () => {
  it("is feature-gated, kill-switchable, and reports browser measurement error", () => {
    document.body.innerHTML = '<main><p id="plain">Plain text</p><p><em>Rich text</em></p></main>';
    const root = document.querySelector("main")!;
    const engine = fakeEngine();
    const experiment = new PretextMeasurementExperiment(engine);
    const gate = new PretextExperimentGate();
    const options = {
      gate,
      typography: TYPOGRAPHY,
      readContentBox: () => ({ width: 320, height: 25 }),
    };

    expect(measurePretextErrors(root, experiment, options).state).toBe("disabled");
    expect(engine.prepare).not.toHaveBeenCalled();

    gate.setEnabled(true);
    const report = measurePretextErrors(root, experiment, options);
    expect(report).toEqual({
      state: "measured",
      measurements: [
        {
          blockId: "paragraph-1",
          elementId: "plain",
          predictedHeightPx: 20,
          actualHeightPx: 25,
          absoluteErrorPx: 5,
          percentageError: 20,
        },
      ],
      summary: {
        measuredCount: 1,
        skippedCount: 1,
        meanAbsoluteErrorPx: 5,
        maximumAbsoluteErrorPx: 5,
        meanPercentageError: 20,
      },
    });

    gate.kill();
    expect(measurePretextErrors(root, experiment, options).state).toBe("killed");
  });
});
