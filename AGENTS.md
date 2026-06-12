# Agent Instructions

Ebook/PDF reader web app: React Router v7 (framework mode) + TypeScript, Tailwind v4, shadcn/ui (Base UI), epubjs + pdfjs, dockview workspace, TipTap notebooks, Effect.ts, Postgres (`pg`), WebAuthn passkeys, Vercel Blob, local-first sync.

## Package Manager
- Use **pnpm** (`pnpm@10.29.2`): `pnpm install`

## Commands
| Task | Command |
|------|---------|
| Dev server | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Test (watch) | `pnpm test` |
| Test one file | `pnpm vitest run path/to/file.test.ts` |
| Lint | `pnpm oxlint` |
| Lint one path | `pnpm oxlint path/to/file.ts` |
| Format | `pnpm oxfmt .` |
| E2E (all) | `pnpm e2e` |
| E2E one file | `pnpm playwright test e2e/chat.spec.ts` |
| Build | `pnpm build` |
| Add shadcn component | `pnpx shadcn@latest add <component>` |

Run `pnpm oxfmt .` and `pnpm oxlint` before committing; fix all warnings. Run `pnpm e2e` after structural refactors.

## External References
| Need | File |
|------|------|
| Architecture (workspace, storage, sync, chat, sharing) | `docs/architecture.md` |
| Effect.ts conventions (services, errors, runtime) | `docs/effect-conventions.md` |
| E2E fixture epub | `e2e/fixtures/test-book.epub` |

## Key Conventions
- Conventional commits (`feat:`, `fix:`); no emoji.
- Conditional Tailwind classes via `cn()` with object syntax, not inline template literals.
- shadcn uses Base UI, not Radix — check APIs accordingly (e.g. `DropdownMenuLabel` must be inside `DropdownMenuGroup`).
- Prefer self-hosted fonts (`public/fonts/`) over CDN when files are local.
- Wrap custom event dispatches in `queueMicrotask()` to avoid React `flushSync` errors.
- Use `useSyncListener(["entity"])` for sync reactivity, not raw event listeners.
- Use `clientLoader` (not `loader`); all epub/pdf/IndexedDB/render work is client-side only.
- Add IDB store accessors to `app/lib/sync/stores.ts` (lazy getters, one db per entity); never `createStore()` at module scope (SSR breaks).

## Component Architecture
- No file over ~500 lines — extract hooks or decompose into sub-components.
- No barrel modules: no `index.ts` re-exports; import from the source module.
- No prop drilling: consume context directly via its hook (e.g. `useWorkspace()`), not via adapter components. Exception: components used in multiple contexts (e.g. `BookReader`) accept props for context-dependent parts.
- Extract shared logic into `app/hooks/`; decompose large components into a subdirectory of focused modules (see `app/components/chat/`).
