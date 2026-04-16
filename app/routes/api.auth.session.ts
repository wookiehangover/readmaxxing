import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { getUser } from "~/lib/database/user/user";

export async function loader({ request }: { request: Request }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ user: null }, { status: 401 });
  }

  const sessionInfo = await getSessionFromRequest(request);
  if (!sessionInfo) {
    return Response.json({ user: null }, { status: 401 });
  }

  const user = await getUser(sessionInfo.userId);
  if (!user) {
    return Response.json({ user: null }, { status: 401 });
  }

  return Response.json({
    user: {
      id: user.id,
      displayName: user.displayName,
    },
  });
}
