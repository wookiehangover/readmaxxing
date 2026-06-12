# Ebook Cleaner Specification

## Intent

Provide a repeatable workflow for cleaning user-provided EPUB files using Standard Ebooks-style production habits: valid packaging, semantic navigation, factual metadata, local styling, and validation before delivery.

## Scope

In scope:
- EPUB inspection, extraction, repair, rebuilding, validation, and delivery.
- Google Docs/Word, Calibre, Fb2epub, EPUB 2, and lightly malformed EPUB cleanup.
- Project-local output creation and approved moves/replacements outside the workspace.

Out of scope:
- DRM removal or access bypass.
- Fetching replacement ebook copies.
- AI-generated descriptions, summaries, subjects, reviews, or invented publication metadata.
- Full OCR or proofreading unless the user separately requests it.

## Users And Trigger Context

- Primary users: agents improving a user-supplied `.epub`.
- Common requests: “clean this ebook,” “run Standard Ebooks improvements,” “fix EPUB nav,” “make this EPUB nicer,” “move the finished copy to books/iCloud.”
- Should not trigger for: writing a new book, generic document editing, PDF-only workflows, or bookstore/library recommendation tasks.

## Runtime Contract

- Required first actions: inspect the input file, work on a copy in the workspace, and choose the smallest safe cleanup path.
- Required outputs: a finished EPUB path, validation result, summary of structural changes, and any unavailable validators.
- Non-negotiable constraints: preserve source content and assets; do not invent metadata; request approval for writes outside the workspace.
- Expected bundled files loaded at runtime: `SKILL.md`, then scripts as needed.

## Source And Evidence Model

Authoritative sources:
- Standard Ebooks production guidance.
- EPUB container/package/nav rules as enforced by XML parsing and link/manifest checks.
- Local examples from the ebook-cleaning thread that produced the first two working transformations.

Useful improvement sources:
- positive examples: successfully cleaned Google Docs-export EPUB and EPUB 2/Fb2epub-style memoir.
- negative examples: broken `href="#"` nav, single-entry NCX, remote font imports, converter metadata, missing/unused manifest items.
- validation results: built-in script output plus optional `epubcheck` or Standard Ebooks CLI output.

Data that must not be stored:
- private ebook contents beyond minimal diagnostic snippets.
- user-specific iCloud/download paths in runtime guidance.
- credentials, library account data, or DRM-related details.

## Reference Architecture

- `SKILL.md` contains: triggers, workflow, safety constraints, script contracts, and delivery requirements.
- `references/` contains: none initially; add only for branch-specific deep guidance.
- `scripts/` contains: inspection and validation helpers.
- `SOURCES.md` contains: provenance, decisions, coverage, and gaps.

## Validation

- Lightweight validation: `scripts/validate_epub.py <epub>`.
- Deeper validation: external `epubcheck`, Standard Ebooks CLI, or reader smoke tests when available.
- Holdout examples: Google Docs single-XHTML export; EPUB 2 package with NCX-only TOC.
- Acceptance gates: no XML parse errors, first uncompressed `mimetype`, existing OPF manifest files, and resolvable local `href`/`src` references.

## Known Limitations

- Built-in validation is structural, not a full EPUBCheck replacement.
- The skill does not guarantee Standard Ebooks house style compliance for copyrighted modern works; it applies practical production-style cleanup.
- Rebuild scripts may still need book-specific logic for chapter detection.

## Maintenance Notes

- Update `SKILL.md` when the operational workflow or safety constraints change.
- Update `SOURCES.md` when new examples or validation gaps are discovered.
- Add a reference file only when a cleanup branch needs more detail than the runtime router should carry.
