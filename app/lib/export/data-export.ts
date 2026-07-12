import { Effect } from "effect";
import { strToU8, zipSync } from "fflate";
import { tiptapJsonToMarkdown } from "~/lib/editor/tiptap-to-markdown";
import { AppRuntime } from "~/lib/effect-runtime";
import { AnnotationService } from "~/lib/stores/annotations-store";
import { BookService, type BookMeta } from "~/lib/stores/book-store";
import { ChatService, type ChatSession } from "~/lib/stores/chat-store";

export interface BookDataExport {
  blob: Blob;
  filename: string;
}

const INVALID_PATH_CHARACTERS = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);

function sanitizePathSegment(value: string): string {
  const sanitized = Array.from(value, (character) =>
    character.charCodeAt(0) < 32 || INVALID_PATH_CHARACTERS.has(character) ? "-" : character,
  )
    .join("")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^[ .-]+|[ .-]+$/g, "");

  return sanitized || "book";
}

function bookFolder(book: BookMeta, includeIdSuffix: boolean): string {
  const title = sanitizePathSegment(book.title);
  if (!includeIdSuffix) return title;

  const idSuffix = book.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-8) || "book";
  return `${title} - ${idSuffix}`;
}

function exportSessions(sessions: ChatSession[]) {
  return sessions
    .filter((session) => session.messages.length > 0)
    .map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt,
        parts: message.parts ?? [],
      })),
    }));
}

export async function exportBookData(bookId: string): Promise<BookDataExport | null> {
  const isAllBooks = bookId === "all";
  const bookData = await AppRuntime.runPromise(
    Effect.gen(function* () {
      const bookService = yield* BookService;
      const annotationService = yield* AnnotationService;
      const chatService = yield* ChatService;
      const books = yield* bookService.getBooks();
      const selectedBooks = isAllBooks ? books : books.filter((book) => book.id === bookId);
      const gathered = [];

      for (const book of selectedBooks) {
        const notebook = yield* annotationService.getNotebook(book.id);
        const sessions = yield* chatService.getSessionsByBook(book.id);
        gathered.push({ book, notebook, sessions });
      }

      return gathered;
    }),
  );

  const files: Record<string, Uint8Array> = {};
  for (const { book, notebook, sessions } of bookData) {
    const folder = bookFolder(book, isAllBooks);
    const notes = notebook ? tiptapJsonToMarkdown(notebook.content).trim() : "";
    const chats = exportSessions(sessions);

    if (notes) files[`${folder}/notes.md`] = strToU8(`${notes}\n`);
    if (chats.length > 0) {
      files[`${folder}/chats.json`] = strToU8(`${JSON.stringify(chats, null, 2)}\n`);
    }
  }

  if (Object.keys(files).length === 0) return null;

  const archive = zipSync(files, { level: 6 });
  const filename = isAllBooks
    ? "readmaxxing-export-all.zip"
    : `readmaxxing-export-${sanitizePathSegment(bookData[0].book.title)
        .toLowerCase()
        .replace(/\s+/g, "-")}.zip`;

  return { blob: new Blob([archive], { type: "application/zip" }), filename };
}
