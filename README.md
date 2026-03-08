# Ebook Reader

A browser-based ebook reader. Drag and drop `.epub` files to load them, and read with customizable typography and layout settings. Books are stored locally in IndexedDB — no server or account required.

## Features

- **Drag-and-drop loading** — drop `.epub` files anywhere on the page
- **Local persistence** — books and reading positions stored in IndexedDB
- **Inbox-style layout** — book list sidebar with reader pane
- **Dark mode** — system-aware with manual toggle
- **Layout modes** — single page, two-page spread, continuous scroll
- **Typography controls** — font family, size, and line height
- **Reading progress** — chapter and overall progress indicators
- **Position memory** — resumes where you left off per book

## Tech Stack

- [React Router v7](https://reactrouter.com/) (framework mode)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [epubjs](https://github.com/futurepress/epub.js) — epub parsing and rendering
- [idb-keyval](https://github.com/nickersk/idb-keyval) — IndexedDB storage

## Getting Started

```bash
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173) and drop an `.epub` file to get started.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start development server |
| `pnpm run build` | Production build |
| `pnpm run start` | Serve production build |
| `pnpm run typecheck` | Run TypeScript type checking |
| `pnpm run lint` | Lint with oxlint |
| `pnpm run format` | Format with oxfmt |

## License

MIT