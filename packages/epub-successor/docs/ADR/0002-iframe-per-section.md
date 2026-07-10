# ADR-0002: One scriptless sandboxed iframe per active section

- Status: Accepted
- Date: 2026-07-10

## Context

Publication content is untrusted HTML/CSS/SVG/MathML. It must not share the host document's cascade or directly navigate, submit, open windows, download, or execute scripts. The host still needs DOM access for browser-authoritative measurement, range locators, selection, and decorations.

Rendering all spine items together increases DOM/memory cost, broadens the active attack surface, and complicates resource lifetimes.

## Decision

The navigator mounts exactly one active spine section in an iframe loaded from a prepared blob URL. The iframe uses `sandbox="allow-same-origin"` and intentionally omits `allow-scripts` and all other capability tokens.

Before mounting, the content pipeline sanitizes the document, rewrites allowed package resources, and injects a restrictive CSP. The parent owns link listeners, navigation, measurement, and decoration behavior. Section replacement follows prepare → mount/load → settle → unload old frame → release old lease.

`allow-same-origin` is required because blob URLs inherit the creator origin and parent DOM access is part of the navigator contract. The unsafe `allow-same-origin` plus `allow-scripts` combination is prohibited.

## Consequences

Positive:

- Publication styles are isolated from host layout.
- Only one section's DOM and resource graph remain active.
- DOM ranges and geometry stay directly accessible to trusted parent code.
- Section leases map cleanly to iframe lifetime.

Negative:

- Same-origin access leaves a larger residual impact if script prevention fails.
- Cross-section continuous scrolling requires orchestration or a future bounded window design.
- iframe loading, focus, and accessibility require explicit tests in every browser.

## Alternatives rejected

- **Render into host shadow DOM:** CSS isolation is incomplete for several document behaviors and the attack surface shares the host realm.
- **Opaque-origin sandbox without `allow-same-origin`:** prevents parent DOM measurement and range/decorations contracts.
- **All spine items in one iframe:** increases memory, URL lifetimes, and layout churn.
- **`allow-scripts` for scripted EPUB:** conflicts with the default threat model and materially weakens same-origin isolation.

## Validation

Security tests inspect sandbox tokens and CSP, attempt every blocked capability, and fail on publication-initiated network requests. Lifecycle tests require one active iframe and zero section URLs after close.

## References

- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
