# ADR-0006: Pre-layout prediction is optional and isolated

- Status: Accepted
- Date: 2026-07-10

## Context

Parsing text and style features before mount may predict section extent, page-count range, or preparation cost. Predictions could improve loading indicators, placeholder sizing, and prefetch choices. They cannot reproduce browser font shaping, CSS fragmentation, image sizing, accessibility settings, or engine-specific geometry.

If prediction enters core locator or navigation semantics, the system effectively gains a second layout engine whose disagreement becomes a correctness bug.

## Decision

Place prediction in the isolated `pretext-layout` module behind a small injected `PretextPredictor` contract.

It may return:

- approximate block extent;
- page-count interval, not an exact promise;
- confidence and explanatory signals;
- prefetch/cache priority.

It may not return locators, CFIs, page boundaries, DOM coordinates, selection ranges, decoration geometry, or relocation state.

The navigator integration is strictly **predict → mount → measure → correct**. Browser measurement always wins. The core engine works identically when no predictor is installed, and main-chain modules do not import its implementation.

## Consequences

Positive:

- Prediction can be evaluated or removed without affecting correctness.
- Experiments have explicit accuracy, latency, and visual-stability metrics.
- The browser remains the only layout authority.

Negative:

- Predictions may be discarded after spending CPU.
- Correction can cause visible placeholder or progress changes.
- A narrow contract limits ambitious precomputation use cases by design.

## Alternatives rejected

- **Mandatory pre-layout engine:** adds startup work and a correctness dependency before proving value.
- **Prediction-generated locators/pages:** persists results known to vary with browser layout.
- **No prediction ever:** unnecessarily excludes potentially useful, safely advisory performance work.

## Acceptance gate

A predictor ships only if representative browser tests show a meaningful improvement in a named latency or visual-stability metric, bounded CPU/memory cost, and zero difference in settled locator results. Otherwise the implementation remains absent or experimental.

## References

- [ADR-0001: Browser layout is authoritative](./0001-authoritative-browser-layout.md)
- [MDN: CSS multi-column layout](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_multicol_layout)
