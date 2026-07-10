# ADR-0005: Scripted publication content is unsupported

- Status: Accepted
- Date: 2026-07-10

## Context

EPUB 3 can include scripted content, but executing publisher JavaScript inside a browser reader substantially expands capability and attack surface. This design also requires `allow-same-origin` so trusted parent code can measure DOM, create ranges, and paint decorations. MDN explicitly warns that combining same-origin and scripts can neutralize sandbox protection when embedded content can remove the sandbox attribute.

Supporting scripts would require a distinct trust model, origin isolation, storage/network policy, message protocol, navigation mediation, and conformance effort.

## Decision

Publication scripts are disabled and unsupported in the first product scope:

- Sanitization removes script elements, inline handlers, script URLs, script-capable embeds, and active SVG/MathML constructs.
- The iframe sandbox omits `allow-scripts`.
- CSP sets `script-src 'none'` and blocks connections, frames, objects, forms, and base changes.
- The public content policy cannot opt into scripts.
- Scripted spine items are rendered as inert content when safely possible and otherwise rejected with a diagnostic.

Parent-owned code may attach trusted event listeners from outside the frame for selection, safe links, measurement, and navigation. It must never evaluate strings from the publication.

## Consequences

Positive:

- The same-origin DOM needed for locators does not also execute untrusted code.
- Network, storage, popup, form, and top-navigation exposure is dramatically reduced.
- Lifecycle and layout remain under navigator control.

Negative:

- Interactive textbooks, quizzes, widgets, and other scripted EPUB content lose behavior.
- The engine cannot claim conformance for scripted-content requirements.
- Some safe declarative content may need explicit sanitizer support.

## Alternatives rejected

- **Scripts enabled by option:** makes security dependent on application callers and creates two incompatible engine modes.
- **Scripts in the same-origin iframe:** unacceptable combination with the required DOM access.
- **Opaque-origin scripted iframe:** safer than same-origin scripts but cannot satisfy current measurement/contracts without a separate message-based renderer architecture.
- **Static script analysis:** cannot reliably prove arbitrary JavaScript safe.

## Revisit criteria

Revisit only as a separately threat-modeled subsystem with a distinct origin, explicit capability protocol, no host DOM access, conformance fixtures, and application opt-in. It must not weaken the scriptless default.

## References

- [EPUB 3.3: Scripting](https://www.w3.org/TR/epub-33/#sec-scripted-content)
- [EPUB 3.3 Reading Systems: Scripted Content Documents](https://www.w3.org/TR/epub-rs-33/#sec-scripted-content)
- [MDN: iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)
