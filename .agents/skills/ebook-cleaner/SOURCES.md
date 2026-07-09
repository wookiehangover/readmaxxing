# Ebook Cleaner Sources

## Source Inventory

| Source | Trust | Confidence | Contribution | Constraints |
|---|---:|---:|---|---|
| Standard Ebooks, “Producing an Ebook, Step by Step” (`https://standardebooks.org/contribute/producing-an-ebook-step-by-step`) | High | High | Production goals: clean semantics, metadata discipline, lint/validation mindset, no AI-generated metadata | Use as guidance, not a claim of full Standard Ebooks compliance |
| Thread example: Tyler Cowen Google Docs-export EPUB cleanup | High | High | Split one large XHTML, removed remote Google fonts, rebuilt EPUB 3 OPF/nav, validated links/XML/container | Private file path omitted from runtime docs |
| Thread example: Gore Vidal EPUB 2/Fb2epub cleanup | High | High | Preserved existing section files/images, rebuilt metadata, added EPUB 3 nav, repaired NCX, removed embedded font dependency | Private file path omitted from runtime docs |
| Local script validation patterns from `work/rebuild_epub.py` and `work/rebuild_vidal_epub.py` | Medium | High | Container, manifest, XML parse, and local link validation checks | Book-specific rebuild logic should not be blindly generalized |
| `skill-writer` workflow references | High | High | Selected script-backed workflow with validation loop and concise runtime router | Skill is provider-portable; no Claude/Codex-specific mechanics |

## Decisions

| Decision | Status | Rationale |
|---|---|---|
| Classify as `workflow-process` | Adopted | The skill coordinates repeatable file transformation, validation, failure handling, and delivery. |
| Use `script-backed-workflow` | Adopted | EPUB inspection and validation are fragile if done with ad hoc shell alone. |
| Add validation loop as secondary mechanic | Adopted | Broken nav, XML, manifest, and zip container issues are easy to miss without repeatable checks. |
| Keep rebuild logic book-specific | Adopted | Chapter detection and metadata cleanup vary by source export shape. |
| Avoid AI-generated metadata | Adopted | Factual metadata only; aligns with Standard Ebooks-style production discipline. |
| Do not update `skills-lock.json` | Adopted | Existing lock tracks imported third-party skills, not local project skills. |

## Coverage Matrix

| Dimension | Status | Evidence |
|---|---|---|
| Happy path | Covered | Two successful EPUB cleanups delivered and moved/replaced. |
| Edge behavior | Covered | Single XHTML export and EPUB 2/NCX-only source both handled. |
| Failure handling | Covered | Script contracts require fixing validation failures before delivery. |
| Safety boundaries | Covered | No DRM bypass, no replacement fetching, no invented metadata, approval for external writes. |
| Validation | Covered | Built-in structural validator plus optional external validators. |
| Version variance | Partial | EPUB 2 and EPUB 3 covered; image-only/DRM cases are reported as limits. |

## Open Gaps

- No bundled full EPUBCheck replacement.
- No generic automatic chapter splitter; agents still need source-specific rebuild logic.
- No persistent evidence fixtures included because the source ebooks are private user files.
