import { requireAuth } from "~/lib/database/auth-middleware";
import { listBookAliases } from "~/lib/database/sync-delivery/aliases";
export async function loader({ request }: { request: Request }) {
  const { userId } = await requireAuth(request);
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 100));
  try {
    return Response.json(await listBookAliases(userId, url.searchParams.get("cursor"), limit));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    throw error;
  }
}
