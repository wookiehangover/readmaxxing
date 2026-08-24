# ADR-0003: Lease-owned blob URLs for package resources

- Status: Accepted
- Date: 2026-07-10

## Context

EPUB references use package-relative paths inside a ZIP, but browser documents require resolvable URLs for images, styles, fonts, and media. The engine must avoid a local HTTP server, external fetches, long-lived data duplication, and persistent opaque URLs.

Blob URLs inherit the creator origin and remain alive until revoked or the document unloads. Premature revocation breaks in-flight loads; missing revocation leaks memory.

## Decision

The resource loader materializes allowed package resources as blob URLs managed by a reference-counted registry. Prepared document and dependency URLs belong to a `SectionLease`.

Rules:

- Keys are normalized package paths plus effective media type, never author-supplied absolute URLs.
- Duplicate acquisitions share one URL and increment a count.
- The content pipeline rewrites every allowed markup/CSS reference to a registry URL.
- Navigators unload the iframe before releasing its lease; release is queued by one microtask.
- Zero-count URLs are revoked immediately after that safety point.
- Abort/error cleanup releases partial acquisitions in reverse order.
- Publication close revokes every residual URL and clears caches.
- Blob URLs never appear in locators, persistence, logs, analytics, or public diagnostics.

## Consequences

Positive:

- No localhost server, service worker route, or network dependency is required.
- Resource access is scoped to explicit package reads and lifetimes are testable.
- Shared dependencies avoid duplicate URLs within active leases.

Negative:

- The iframe remains same-origin with the creator unless sandbox origin semantics intervene.
- CSS imports and nested resources require recursive rewriting before mount.
- Correctness depends on disciplined ownership and cleanup on every abort path.

## Alternatives rejected

- **Data URLs:** inflate memory/string size, complicate CSP, and are poor for large or nested resources.
- **`srcdoc` plus inline assets:** cannot represent the full resource graph efficiently and still needs URL handling.
- **Local HTTP server/service worker:** adds deployment, routing, origin, and lifecycle complexity that local files do not require.
- **Never revoke URLs:** leaks memory during ordinary navigation.

## Validation

An instrumented URL factory records create/revoke pairs. Unit and browser churn tests require zero live URLs after release/close and verify resources finish loading before revocation.

## References

- [MDN: Blob URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob)
- [MDN: `URL.revokeObjectURL()`](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static)
