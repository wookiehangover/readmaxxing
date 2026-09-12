import { stripVTControlCharacters } from "node:util";
import type { Book, ChatSession } from "./client.js";

export function clean(value: string | null | undefined): string {
  return stripVTControlCharacters(value ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ");
}

export function interactive(stream: NodeJS.WriteStream): boolean {
  return !!stream.isTTY && process.env.TERM !== "dumb" && !process.env.CI;
}

export function tone(
  value: string,
  code: number,
  stream: NodeJS.WriteStream = process.stdout,
): string {
  return interactive(stream) && process.env.NO_COLOR === undefined
    ? `\x1b[${code}m${value}\x1b[0m`
    : value;
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? "KiB" : "MiB";
  return `${(value / (unit === "KiB" ? 1024 : 1024 ** 2)).toFixed(1)} ${unit}`;
}

export interface ProgressUpdate {
  label: string;
  loaded?: number;
  total?: number;
  warning?: string;
}

/** Transient status lives on stderr; pipes and CI never receive animation. */
export class Activity {
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  private visible = false;
  private status: ProgressUpdate;

  constructor(label: string) {
    this.status = { label };
    if (interactive(process.stderr)) {
      this.render();
      this.timer = setInterval(() => this.render(), 80);
      this.timer.unref();
    }
  }

  update = (status: ProgressUpdate): void => {
    if (status.warning) {
      if (this.visible) process.stderr.write("\r\x1b[2K");
      process.stderr.write(`! ${clean(status.warning)}\n`);
      this.visible = false;
    }
    this.status = status;
  };

  private render(): void {
    const { label, loaded, total } = this.status;
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let detail = "";
    if (loaded !== undefined) {
      if (total && total > 0) {
        const fraction = Math.min(1, Math.max(0, loaded / total));
        const filled = Math.floor(fraction * 16);
        detail = `  ${"━".repeat(filled)}${"─".repeat(16 - filled)} ${Math.floor(fraction * 100)}%  ${bytes(loaded)} / ${bytes(total)}`;
      } else detail = `  ${bytes(loaded)}`;
    }
    // Labels are controlled by the CLI, so clipping cannot split user metadata or escape codes.
    const line = `${frames[this.frame++ % frames.length]} ${clean(label)}${detail}`;
    const width = Math.max(1, (process.stderr.columns || 80) - 1);
    process.stderr.write(`\r\x1b[2K${tone(line.slice(0, width), 36, process.stderr)}`);
    this.visible = true;
  }

  stop(): void {
    clearInterval(this.timer);
    if (this.visible) process.stderr.write("\r\x1b[2K");
    this.visible = false;
  }

  async during<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.stop();
    }
  }
}

export function success(message: string): void {
  process.stderr.write(
    `${interactive(process.stderr) ? `${tone("✓", 32, process.stderr)} ` : ""}${clean(message)}\n`,
  );
}

export function listing(headers: string[], rows: (string | null)[][], empty: string): void {
  if (!interactive(process.stdout)) {
    process.stdout.write(
      [headers.join("\t"), ...rows.map((row) => row.map(clean).join("\t"))].join("\n") + "\n",
    );
    return;
  }
  if (!rows.length) {
    process.stdout.write(`${empty}\n`);
    return;
  }
  process.stdout.write(
    rows
      .map(([id, title, ...details]) => {
        const [description, format] = details;
        return `${tone(clean(title) || "Untitled", 1)}${description ? ` · ${clean(description)}` : ""}\n${tone(`  ${clean(id)}${format ? ` · ${clean(format).toUpperCase()}` : ""}`, 2)}`;
      })
      .join("\n\n") + "\n",
  );
}

export function chatListing(sessions: ChatSession[], books: Book[]): void {
  if (!sessions.length) {
    process.stdout.write("No conversations found.\n");
    return;
  }
  const bookById = new Map(books.map((book) => [book.id, book]));
  const groups = new Map<string | null, ChatSession[]>();
  for (const session of sessions) {
    const group = groups.get(session.bookId) ?? [];
    group.push(session);
    groups.set(session.bookId, group);
  }
  process.stdout.write(
    [...groups]
      .map(([bookId, chats]) => {
        const book = bookId ? bookById.get(bookId) : undefined;
        const title = clean(book?.title) || (bookId ? "Unknown book" : "No book");
        const heading = tone(title, 1) + (book?.author ? ` · ${clean(book.author)}` : "");
        const bookLine = bookId ? `\n${tone(`  ${clean(bookId)}`, 2)}` : "";
        const rows = chats.map(
          (chat) => `  ${clean(chat.title) || "Untitled"}\n${tone(`    ${clean(chat.id)}`, 2)}`,
        );
        return `${heading}${bookLine}\n\n${rows.join("\n")}`;
      })
      .join("\n\n") + "\n",
  );
}
