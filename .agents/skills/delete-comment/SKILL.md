---
name: delete-comment
description: Audit code comments in readmaxxing and delete them. Sorts each comment as tautology, stale, excuse, or decision record; deletes it; files a GitHub issue for each excuse; moves each decision into docs/adr/; then tightens the comment-baseline.json ratchet. Use when asked to delete, audit, or clean up comments, or to shrink the comment baseline. Takes an optional path (file or directory); defaults to the whole repo.
---

# Delete comments

Comments are banned by the `comments/no-comments` oxlint rule
(`scripts/no-comments-oxlint-plugin.mjs`). Old comments are allowed only while they are listed in
`comment-baseline.json`. This skill removes old comments and shrinks that list.

## 1. Find the comments

```bash
COMMENT_BASELINE_DUMP=1 pnpm oxlint --format=unix -A all -D comments/no-comments <path>
```

Each line is one comment that still needs work. With no path, use `.`. Directives
(`eslint-disable`, `@ts-expect-error`, `@vitest-environment`, `/* @vite-ignore */`,
`/// <reference>`, `/*! legal */`) are allowed and never listed.

For more than ~250 comments, split the files into batches by directory and give each batch to a
sub-agent with these instructions. Sub-agents must only record and delete; the parent files issues,
writes ADRs, and commits.

## 2. Sort each comment

Read the comment with its code, then pick one category:

| Category  | Test                                                                                       | Action                                  |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------------------- |
| Tautology | It repeats what the names and code already say.                                           | Delete.                                 |
| Stale     | It talks about code, behavior, or plans that no longer match.                              | Delete.                                 |
| Excuse    | It explains away a hack, workaround, TODO, temporary fix, or known defect.                 | Delete and file an issue.               |
| Decision  | It records a non-obvious why: a constraint, trade-off, invariant, or external quirk.       | Delete and move it into an ADR.         |

Hints:

1. When unsure between tautology and decision, ask: "Would a careful reader get this wrong without
   it?" If no, it is a tautology.
2. If a comment is needed to understand a name, rename the symbol or extract a function instead.
3. `TODO`, `HACK`, `FIXME`, `for now`, `workaround`, `temporary`, `until` usually mean excuse.

For JSX, delete the whole `{/* ... */}` expression. Never change code while deleting.

## 3. File excuse issues

One issue per distinct hack; group comments that describe the same hack.

```bash
gh issue create --repo wookiehangover/readmaxxing --label enhancement \
  --title "Replace <hack> in <area>" --body-file <file>
```

Body: what the hack is, where (file and symbol, not line numbers), the risk, and what a real fix
looks like. Check `gh issue list --search "<keywords>"` first to avoid duplicates.

## 4. Write ADRs

ADRs live in `docs/adr/`, one file per area: `NNNN-<area>.md` (see `docs/adr/README.md`).
Add each decision as a section in the matching area file; create a new numbered file only for a new
area. Each section has: title, context, decision, consequences, and code location (file and symbol).
Write the full meaning; the comment is gone.

## 5. Tighten the ratchet and verify

```bash
pnpm oxfmt .
pnpm comments:baseline   # drops deleted comments from comment-baseline.json; never adds
pnpm lint
pnpm comments:check
pnpm typecheck
```

`comments:baseline` only shrinks the baseline. A new comment fails `pnpm lint`; a deleted comment
that is still in the baseline fails `pnpm comments:check`.

## 6. Report

Report counts per category, issues filed (links), ADR files touched, and lines removed
(`git diff --shortstat`).
