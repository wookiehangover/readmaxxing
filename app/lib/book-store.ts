import { createStore, get, set, del, keys } from "idb-keyval";

export interface Book {
  id: string;
  title: string;
  author: string;
  coverImage: Blob | null;
  data: ArrayBuffer;
}

const bookStore = createStore("ebook-reader-db", "books");

export async function saveBook(book: Book): Promise<void> {
  await set(book.id, book, bookStore);
}

export async function getBooks(): Promise<Book[]> {
  const allKeys = await keys(bookStore);
  const books: Book[] = [];
  for (const key of allKeys) {
    const book = await get<Book>(key, bookStore);
    if (book) {
      books.push(book);
    }
  }
  return books;
}

export async function getBook(id: string): Promise<Book | null> {
  const book = await get<Book>(id, bookStore);
  return book ?? null;
}

export async function deleteBook(id: string): Promise<void> {
  await del(id, bookStore);
}

