# Package documentation

Maintainer docs for `@readmaxxing/epub-successor`. Start with the [package README](../README.md) for usage, scripts, and public API.

| Document | Contents |
| -------- | -------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Module map, contracts, navigation state machine, resource lifetimes |
| [SECURITY.md](./SECURITY.md) | Threat model, sandbox/CSP policy, security invariants |
| [SUPPORT_MATRIX.md](./SUPPORT_MATRIX.md) | Supported / experimental / deferred / rejected EPUB features |
| [ADR/](./ADR/) | Architecture decision records |

## Architecture decision records

| ADR | Decision |
| --- | -------- |
| [0001](./ADR/0001-authoritative-browser-layout.md) | Browser layout is authoritative |
| [0002](./ADR/0002-iframe-per-section.md) | One scriptless sandboxed iframe per active section |
| [0003](./ADR/0003-resource-url-strategy.md) | Lease-owned blob URLs for package resources |
| [0004](./ADR/0004-locator-strategy.md) | Composite semantic locators, not page numbers |
| [0005](./ADR/0005-scripts-disabled-by-default.md) | Scripted publication content is unsupported |
| [0006](./ADR/0006-optional-pretext-subsystem.md) | Pre-layout prediction is optional and isolated |
