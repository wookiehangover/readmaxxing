import { DEFAULT_URL } from "./config.js";
import { tone } from "./terminal.js";

const commands: Record<
  string,
  { usage: string; description: string; options?: string; example: string }
> = {
  login: {
    usage: "login [options]",
    description: "Connect your account in the browser. Paste a token only if needed.",
    options:
      "  --no-browser          Print the login link\n  --token-stdin         Read a token from stdin",
    example: "readmaxxing login",
  },
  logout: {
    usage: "logout",
    description: "Revoke this CLI session and remove its saved credentials.",
    example: "readmaxxing logout",
  },
  books: {
    usage: "books [--json]",
    description: "List synced books and their IDs.",
    options: "  --json                Output JSON",
    example: "readmaxxing books --json",
  },
  upload: {
    usage: "upload <file.epub|file.pdf> [options]",
    description:
      "Add a book. EPUB metadata is extracted; PDFs use the filename.\nDuplicate files reuse the existing book. Maximum size: 100 MiB.",
    options:
      "  --title <text>        Set the title\n  --author <text>       Set the author\n  --json                Output JSON",
    example: "readmaxxing upload book.epub",
  },
  download: {
    usage: "download <book-id> [options]",
    description: "Download the original EPUB or PDF. Saves as <title>.<format>.",
    options:
      "  -o, --output <path>   Destination; - pipes the file\n  --force               Replace an existing file",
    example: "readmaxxing download <book-id> -o book.epub",
  },
  chats: {
    usage: "chats [options]",
    description: "List conversations grouped by book, with session IDs.",
    options: "  --book <id>           Filter by book\n  --json                Output JSON",
    example: "readmaxxing chats --book <book-id>",
  },
  export: {
    usage:
      "export <notes|outline|chat> <book-id> [options]\n  readmaxxing export chat --session <session-id> [options]",
    description: "Export synced content as Markdown to stdout. Sync browser edits first.",
    options:
      "  --session <id>        Export one conversation\n  -o, --output <path>   Save to a file\n  --force               Replace an existing file",
    example: "readmaxxing export notes <book-id> -o notes.md",
  },
};

export function help(command?: string): string {
  if (command) {
    const entry = commands[command];
    if (!entry) throw new Error(`Unknown command: ${command}. Run readmaxxing --help.`);
    return `${tone(`readmaxxing ${command}`, 1)}\n\n${entry.description}\n\n  readmaxxing ${entry.usage}\n\n${entry.options ? `${entry.options}\n` : ""}  --url <origin>        Server (default: ${DEFAULT_URL})\n  -h, --help            Show help\n\nExample\n  ${entry.example}\n`;
  }
  return `${tone("readmaxxing", 1)}  Your library, in the terminal.\n\n  readmaxxing <command> [options]\n\n  login       Connect your account\n  logout      Sign out\n  books       List your library\n  upload      Add an EPUB or PDF\n  download    Save an original book\n  chats       List conversations\n  export      Save notes, outlines, or chats as Markdown\n\n  readmaxxing <command> --help\n\nServer       ${DEFAULT_URL} · override with --url\nEnvironment  READMAXXING_URL · READMAXXING_TOKEN · READMAXXING_CONFIG\n\nGet started\n  readmaxxing login\n  readmaxxing books\n`;
}
