---
name: ebook-cleaner
description: Clean and improve user-provided EPUB files using Standard Ebooks-style production practices. Use when asked to improve, clean, rebuild, validate, standardize, repair, or move an ebook/EPUB, especially requests mentioning Standard Ebooks guidelines, EPUB 2 to EPUB 3 cleanup, broken navigation, Google Docs/Calibre/Fb2epub exports, metadata cleanup, or copying the finished book into an iCloud/books folder.
---

# Ebook Cleaner

Use this skill to improve a user-provided EPUB while preserving the work's text and assets. Treat the input as the user's file; do not fetch replacement copies, remove DRM, or add AI-written book metadata.

## First Actions

1. Confirm the source file exists and is an EPUB:
   ```bash
   file "<source.epub>"
   unzip -l "<source.epub>" | sed -n '1,160p'
   ```
2. Create all intermediate work inside the active workspace, with final deliverables in the user-facing output folder when one exists.
3. Run `scripts/inspect_epub.py "<source.epub>"` to identify package path, EPUB version, metadata, spine, nav/NCX state, assets, and likely converter artifacts.
4. Decide the cleanup path:

| Source shape | Use this path |
|---|---|
| One large Google Docs/Word XHTML export | split front matter and chapters; replace inline/remote CSS; rebuild nav and OPF |
| Existing section/chapter files with EPUB 2 OPF/NCX | preserve section files; add EPUB 3 nav; rebuild OPF metadata/manifest/spine; keep NCX for compatibility |
| Already valid EPUB 3 with minor issues | make targeted edits only; avoid full restructure |
| Image-only or DRM/encrypted EPUB | stop and report limits; do not OCR or bypass access unless explicitly requested and lawful tools are available |

## Cleanup Rules

- Preserve the author’s text, images, cover, reading order, and factual metadata.
- Prefer structural repairs over content rewriting: valid XML/XHTML, clean OPF, correct manifest, correct spine, real nav links, local CSS, and semantic headings.
- Remove converter cruft when safe: Calibre/Fb2epub contributor metadata, remote font imports, unused embedded fonts, broken single-entry NCX/TOC, empty spacer paragraphs, and meaningless file titles.
- Normalize author metadata only factually, for example `Gore  Vidal` to `Gore Vidal` with `file-as` `Vidal, Gore`.
- Do not invent descriptions, summaries, subjects, publication facts, ISBNs, or license statements.
- Keep the original source untouched unless the user explicitly asks to replace it. When replacing, make or preserve a backup when practical.
- If writing outside the workspace, request the required filesystem approval instead of working around sandbox boundaries.

## Standard Workflow

1. Extract to a fresh workspace directory.
2. Inspect `META-INF/container.xml`, package OPF, nav/NCX, CSS, spine files, and image references.
3. Rebuild or patch in the smallest safe way:
   - EPUB 3 package with `unique-identifier`, `dc:title`, `dc:creator`, `dc:language`, `dcterms:modified`, manifest, and spine.
   - `nav.xhtml` with one real entry per front/back matter section and chapter.
   - Local CSS with reader-friendly defaults and no remote dependencies.
   - `mimetype` as the first zip member and stored without compression.
4. Validate immediately with `scripts/validate_epub.py "<finished.epub>"`.
5. Fix every reported error, rebuild, and re-run validation before moving or replacing files.
6. If `epubcheck`, Standard Ebooks CLI, or another project-approved validator is available, run it after the built-in validator and report any unavailable tools.

## Script Contracts

| Script | Arguments | Output | Use |
|---|---|---|---|
| `scripts/inspect_epub.py` | `<source.epub>` | JSON summary | First inspection and cleanup path selection |
| `scripts/validate_epub.py` | `<finished.epub>` | `OK` or error list; exit nonzero on failure | Required validation before delivery |

If a script fails because the input is malformed, inspect manually with `unzip`, `sed`, and Python XML parsing. If validation finds broken references, missing manifest files, compressed `mimetype`, or XML parse errors, fix and rebuild before claiming completion.

## Delivery

Report:

1. final EPUB path
2. destination path if moved or replaced
3. major cleanup actions
4. validation results
5. unavailable external validators or remaining gaps
