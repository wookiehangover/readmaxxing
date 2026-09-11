import { requireAuth } from "~/lib/database/auth-middleware";
import { listRecovery } from "~/lib/database/sync-delivery/recovery";
export async function loader({ request }: { request: Request }) {
  const { userId } = await requireAuth(request);
  const url = new URL(request.url);
  try {
    return Response.json(
      await listRecovery(
        userId,
        url.searchParams.get("cursor"),
        Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 50)),
      ),
    );
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError)
      return Response.json({ error: "Invalid cursor" }, { status: 400 });
    throw error;
  }
}
