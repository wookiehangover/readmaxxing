import { nanoid } from "nanoid";
import { requireAuth } from "~/lib/database/auth-middleware";
import { getBookByIdForUser } from "~/lib/database/book/book";
import { createShareLink } from "~/lib/database/share/share-link";

interface CreateShareRequestBody {
  bookId?: unknown;
  maxUses?: unknown;
  shareChats?: unknown;
}

function parseCreateShareBody(body: CreateShareRequestBody) {
  if (typeof body.bookId !== "string" || body.bookId.length === 0) {
    throw Response.json({ error: "bookId is required" }, { status: 400 });
  }

  let maxUses: number | null = null;
  if (body.maxUses != null) {
    if (typeof body.maxUses !== "number" || !Number.isInteger(body.maxUses) || body.maxUses < 1) {
      throw Response.json({ error: "maxUses must be a positive integer" }, { status: 400 });
    }
    maxUses = body.maxUses;
  }

  if (body.shareChats != null && typeof body.shareChats !== "boolean") {
    throw Response.json({ error: "shareChats must be a boolean" }, { status: 400 });
  }

  return {
    bookId: body.bookId,
    maxUses,
    shareChats: body.shareChats === true,
  };
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const { userId } = await requireAuth(request);

  let body: CreateShareRequestBody;
  try {
    body = (await request.json()) as CreateShareRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { bookId, maxUses, shareChats } = parseCreateShareBody(body);
  const book = await getBookByIdForUser(bookId, userId);
  if (!book || book.deletedAt) {
    return Response.json({ error: "Book not found" }, { status: 404 });
  }
  if (!book.fileBlobUrl) {
    return Response.json({ error: "Book file has not been synced" }, { status: 409 });
  }

  const id = nanoid(12);
  const shareLink = await createShareLink({ id, userId, bookId, maxUses, shareChats });
  if (!shareLink) {
    return Response.json({ error: "Failed to create share link" }, { status: 500 });
  }

  const url = new URL(`/share/${id}`, request.url).toString();
  return Response.json({ id, url });
}
