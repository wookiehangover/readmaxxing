import { z } from "zod";
import { BookService } from "~/lib/stores/book-store";
import { MAX_REPAIR_BYTES, repairJobSchema } from "./repair-types";

export const repairUrl = (bookId: string) => `/api/book-repair/${encodeURIComponent(bookId)}`;

async function readResponse(response: Response) {
  const body = await response.json().catch(() => {
    throw new Error("Book repair is unavailable. Please try again.");
  });
  if (!response.ok)
    throw new Error(typeof body.error === "string" ? body.error : "Book repair request failed.");
  return z.object({ job: repairJobSchema.nullable() }).parse(body).job;
}

export async function startBookRepair(bookId: string, signal: AbortSignal) {
  const book = await BookService.getBook(bookId);
  if (book.format === "pdf") throw new Error("Book repair currently supports EPUB files only.");
  const data = await BookService.getBookData(bookId);
  if (data.byteLength > MAX_REPAIR_BYTES)
    throw new Error("Book repair supports files up to 4 MiB.");
  return readResponse(
    await fetch(repairUrl(bookId), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/epub+zip" },
      body: data,
      signal,
    }),
  );
}

export async function fetchBookRepair(bookId: string, signal: AbortSignal) {
  return readResponse(await fetch(repairUrl(bookId), { credentials: "include", signal }));
}

export async function fetchRepairedFile(bookId: string, jobId: string) {
  const response = await fetch(
    `${repairUrl(bookId)}?jobId=${encodeURIComponent(jobId)}&download=1`,
    { credentials: "include" },
  );
  if (!response.ok) throw new Error("The repaired file is no longer available. Run repair again.");
  return response.arrayBuffer();
}

export function downloadRepairCopy(data: ArrayBuffer, title: string) {
  const url = URL.createObjectURL(new Blob([data], { type: "application/epub+zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|]/g, "-")} (repaired).epub`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
