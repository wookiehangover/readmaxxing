import { parseArgs } from "node:util";
import { rm } from "node:fs/promises";
import { Client, type Book, type ChatSession } from "./client.js";
import { configPath, loginUrl, readConfig } from "./config.js";
import { safeFilename, writeOutput } from "./output.js";
import { uploadBook } from "./upload.js";
import { login } from "./login.js";

import { help } from "./help.js";
import { Activity, chatListing, clean, interactive, listing, success, tone } from "./terminal.js";

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
    process.stdout.write(help(command === "help" ? rest[0] : command));
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
    throw new Error(`Invalid arguments for ${command}. Run readmaxxing ${command} --help.`);
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
      await new Activity("Signing out").during(() =>
        client.request("/api/auth/logout", { method: "POST" }),
      );
      // An environment credential can differ from the locally saved session.
      const { readFile } = await import("node:fs/promises");
      try {
        const saved = JSON.parse(await readFile(configPath(), "utf8"));
        if (saved.url === config.url && saved.token === config.token)
          await rm(configPath(), { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      success("Signed out");
      if (process.env.READMAXXING_TOKEN)
        process.stderr.write("Unset READMAXXING_TOKEN to clear your environment token.\n");
      break;
    }
    case "books": {
      const books = await new Activity("Loading books").during(() => client.pull<Book>("book"));
      if (values.json) process.stdout.write(`${JSON.stringify(books, null, 2)}\n`);
      else
        listing(
          ["ID", "TITLE", "AUTHOR", "FORMAT"],
          books.map((book) => [book.id, book.title, book.author, book.format]),
          "No books yet. Add one with readmaxxing upload <file>.",
        );
      break;
    }
    case "chats": {
      const { sessions, books } = await new Activity("Loading chats").during(async () => {
        const sessions = (await client.pull<ChatSession>("chat_session")).filter(
          (session) => !values.book || session.bookId === values.book,
        );
        // Retain book tombstones here so deleted books cannot reappear as unknown groups.
        const books = sessions.some((session) => session.bookId != null)
          ? await client.pull<Book>("book", { includeDeleted: true })
          : [];
        const deletedBookIds = new Set(
          books.filter((book) => book.deletedAt != null).map((book) => book.id),
        );
        return {
          sessions: sessions.filter(
            (session) => session.bookId == null || !deletedBookIds.has(session.bookId),
          ),
          books: books.filter((book) => book.deletedAt == null),
        };
      });
      if (values.json) process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
      else if (interactive(process.stdout)) chatListing(sessions, books);
      else
        listing(
          ["ID", "TITLE", "BOOK"],
          sessions.map((session) => [session.id, session.title, session.bookId]),
          "No conversations found.",
        );
      break;
    }
    case "upload": {
      const activity = new Activity("Reading book");
      const book = await activity.during(() =>
        uploadBook(
          client,
          rest[0],
          {
            title: values.title,
            author: values.author,
          },
          activity.update,
        ),
      );
      process.stdout.write(
        values.json
          ? `${JSON.stringify(book, null, 2)}\n`
          : process.stdout.isTTY
            ? `${tone("✓", 32)} ${tone(clean(book.title), 1)}\n${tone(`  ${clean(book.id)}`, 2)}\n`
            : `${clean(book.id)}\t${clean(book.title)}\n`,
      );
      break;
    }
    case "download": {
      const activity = new Activity("Finding book");
      await activity.during(async () => {
        const book = await client.book(rest[0]);
        const output =
          values.output ??
          `${safeFilename(book.title ?? book.id)}.${book.format === "pdf" ? "pdf" : "epub"}`;
        if (output === "-" && process.stdout.isTTY)
          throw new Error("Redirect binary output to a file or pipe.");
        activity.update({ label: "Downloading" });
        await writeOutput(
          await client.request(
            `/api/sync/files/download?${new URLSearchParams({ bookId: book.id, type: "file" })}`,
          ),
          output,
          values.force,
          (loaded, total) => activity.update({ label: "Downloading", loaded, total }),
        );
        activity.stop();
        if (output !== "-") success(`Saved ${output}`);
      });
      break;
    }
    case "export": {
      const query = new URLSearchParams({
        kind: rest[0],
        ...(values.session ? { sessionId: values.session } : { bookId: rest[1] }),
      });
      const activity = new Activity("Exporting Markdown");
      await activity.during(async () => {
        const response = await client.request(`/api/cli/export?${query}`);
        await writeOutput(response, values.output ?? "-", values.force);
      });
      if (values.output && values.output !== "-") success(`Saved ${values.output}`);
      break;
    }
  }
}
