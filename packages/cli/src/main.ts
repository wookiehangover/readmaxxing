import { parseArgs, stripVTControlCharacters } from "node:util";
import { rm } from "node:fs/promises";
import { Client, type Book, type ChatSession } from "./client.js";
import { DEFAULT_URL, configPath, loginUrl, readConfig } from "./config.js";
import { safeFilename, writeOutput } from "./output.js";
import { uploadBook } from "./upload.js";
import { login } from "./login.js";

const HELP = `Readmaxxing CLI

Usage:
  readmaxxing login [--url <origin>] [--token-stdin] [--no-browser]
  readmaxxing logout [--url <origin>]
  readmaxxing books [--json]
  readmaxxing upload <file.epub|file.pdf> [--title <title>] [--author <author>] [--json]
  readmaxxing download <book-id> [-o <file|->] [--force]
  readmaxxing chats [--book <book-id>] [--json]
  readmaxxing export <notes|outline|chat> <book-id> [-o <file|->] [--force]
  readmaxxing export chat --session <session-id> [-o <file|->] [--force]

The default server is ${DEFAULT_URL}. Sign in with readmaxxing login.
Login connects automatically through a temporary localhost callback. If it fails,
press Enter in the terminal and paste the token shown in the browser.
--no-browser prints the login link; --token-stdin accepts a token without a callback.
All commands accept --url. Exports default to stdout; downloads default to
<title>.<epub|pdf>. Existing files require --force. Book IDs come from books.
Chat exports saved conversations; --session selects one conversation.

Environment: READMAXXING_URL, READMAXXING_TOKEN, READMAXXING_CONFIG.
Credentials default to ~/.config/readmaxxing/config.json (or XDG_CONFIG_HOME).
Only synced data is available. Sync browser edits before exporting.
EPUB title, author, and cover are extracted; PDFs use their filename by default.
`;

function clean(value: string | null): string {
  return stripVTControlCharacters(value ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ");
}

export async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      url: { type: "string" },
      json: { type: "boolean" },
      output: { type: "string", short: "o" },
      force: { type: "boolean" },
      title: { type: "string" },
      author: { type: "string" },
      book: { type: "string" },
      session: { type: "string" },
      "token-stdin": { type: "boolean" },
      "no-browser": { type: "boolean" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  const allowed: Record<string, string[]> = {
    login: ["token-stdin", "no-browser"],
    logout: [],
    books: ["json"],
    upload: ["title", "author", "json"],
    download: ["output", "force"],
    chats: ["book", "json"],
    export: ["session", "output", "force"],
  };
  if (!allowed[command]) throw new Error(`Unknown command: ${command}. Run readmaxxing --help.`);
  for (const option of Object.keys(values)) {
    if (option !== "url" && !allowed[command].includes(option))
      throw new Error(`--${option} is not valid for ${command}.`);
  }
  const expected =
    command === "upload" || command === "download"
      ? 1
      : command === "export"
        ? values.session
          ? 1
          : 2
        : 0;
  if (rest.length !== expected || rest.some((value) => !value.trim()))
    throw new Error(`Invalid arguments for ${command}. Run readmaxxing --help.`);
  if (
    command === "export" &&
    (!["notes", "outline", "chat"].includes(rest[0]) || (values.session && rest[0] !== "chat"))
  )
    throw new Error("Export kind must be notes, outline, or chat; --session only applies to chat.");
  if (command === "login") {
    await login(await loginUrl(values.url), !!values["token-stdin"], !!values["no-browser"]);
    return;
  }
  const config = await readConfig(values.url);
  const client = new Client(config);
  switch (command) {
    case "logout": {
      await client.request("/api/auth/logout", { method: "POST" });
      // An environment credential can differ from the locally saved session.
      const { readFile } = await import("node:fs/promises");
      try {
        const saved = JSON.parse(await readFile(configPath(), "utf8"));
        if (saved.url === config.url && saved.token === config.token)
          await rm(configPath(), { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      process.stderr.write("CLI session revoked. Clear READMAXXING_TOKEN if you set it.\n");
      break;
    }
    case "books": {
      const books = await client.pull<Book>("book");
      if (values.json) process.stdout.write(`${JSON.stringify(books, null, 2)}\n`);
      else
        process.stdout.write(
          [
            "ID\tTITLE\tAUTHOR\tFORMAT",
            ...books.map((book) =>
              [book.id, book.title, book.author, book.format].map(clean).join("\t"),
            ),
          ].join("\n") + "\n",
        );
      break;
    }
    case "chats": {
      const sessions = (await client.pull<ChatSession>("chat_session")).filter(
        (session) => !values.book || session.bookId === values.book,
      );
      if (values.json) process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      else
        process.stdout.write(
          [
            "ID\tTITLE\tBOOK",
            ...sessions.map((session) =>
              [session.id, session.title, session.bookId].map(clean).join("\t"),
            ),
          ].join("\n") + "\n",
        );
      break;
    }
    case "upload": {
      const book = await uploadBook(client, rest[0], {
        title: values.title,
        author: values.author,
      });
      process.stdout.write(
        values.json
          ? `${JSON.stringify(book, null, 2)}\n`
          : `${clean(book.id)}\t${clean(book.title)}\n`,
      );
      break;
    }
    case "download": {
      const book = await client.book(rest[0]);
      const output =
        values.output ??
        `${safeFilename(book.title ?? book.id)}.${book.format === "pdf" ? "pdf" : "epub"}`;
      if (output === "-" && process.stdout.isTTY)
        throw new Error("Redirect binary output to a file or pipe.");
      await writeOutput(
        await client.request(
          `/api/sync/files/download?${new URLSearchParams({ bookId: book.id, type: "file" })}`,
        ),
        output,
        values.force,
      );
      if (output !== "-") process.stderr.write(`Saved ${output}\n`);
      break;
    }
    case "export": {
      const query = new URLSearchParams({
        kind: rest[0],
        ...(values.session ? { sessionId: values.session } : { bookId: rest[1] }),
      });
      const response = await client.request(`/api/cli/export?${query}`);
      await writeOutput(response, values.output ?? "-", values.force);
      if (values.output && values.output !== "-") process.stderr.write(`Saved ${values.output}\n`);
      break;
    }
  }
}
