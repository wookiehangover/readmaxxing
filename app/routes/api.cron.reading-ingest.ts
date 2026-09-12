import { isCronAuthorized } from "~/lib/database/cron-auth";
import { sweepReadingIngestQueues } from "~/lib/reading-agent/dispatch.server";

export async function loader({ request }: { request: Request }): Promise<Response> {
  if (!isCronAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const swept = await sweepReadingIngestQueues();
  return Response.json({ swept });
}
