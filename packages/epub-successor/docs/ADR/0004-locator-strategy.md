# ADR-0004: Composite semantic locators, not page numbers

- Status: Accepted
- Date: 2026-07-10

## Context

Reflow changes physical pages whenever viewport, fonts, preferences, zoom, browser, or content resources change. Pixel offsets and page indexes are not durable. EPUB CFI provides publication-aware addressing, but real-world markup changes, unsupported CFI features, and application-generated selections require recovery paths.

Readium-style locators provide a practical envelope for resource identity, progression, fragments, position, and text context.

## Decision

Persist a composite `Locator` containing:

- normalized package-relative `href` as required identity;
- media type and optional title;
- the strongest available semantic anchor: CFI and/or range selectors;
- optional fragment, generated position, resource progression, and total progression;
- bounded text context (`before`, `highlight`, `after`) when caller privacy policy allows it.

Resolution order is exact CFI/range, text-quote recovery in the same resource, selector/fragment, then progression. Resolution reports confidence and never silently crosses spine resources.

Generated positions are deterministic text breakpoints and must not be labeled pages. Session page indexes may be reported in relocation metadata but are never authoritative or persisted as the sole anchor.

## Consequences

Positive:

- Locations survive reflow and many benign markup changes.
- The model supports navigation, bookmarks, annotations, sync, and interoperation.
- Failures degrade through explicit, testable fallbacks.

Negative:

- Multiple anchors increase payload and resolution complexity.
- Text context can contain sensitive reading material and needs an application privacy policy.
- The initial CFI implementation must document a supported subset.

## Alternatives rejected

- **Page number only:** unstable under all meaningful presentation changes.
- **Pixel/scroll offset only:** browser- and viewport-specific with poor recovery.
- **CSS selector only:** fragile under publisher markup changes and non-unique selectors.
- **CFI only:** strong for many documents but insufficient as the sole recovery mechanism and expensive to implement completely at once.

## Validation

Round-trip tests require selected text to survive range → locator → range in each supported browser. Reflow tests change viewport and preferences, then require same-resource recovery with recorded confidence.

## References

- [EPUB Canonical Fragment Identifiers 1.1](https://www.w3.org/TR/epub-cfi-11/)
- [Readium Architecture: Locators](https://readium.org/architecture/models/locators/)
