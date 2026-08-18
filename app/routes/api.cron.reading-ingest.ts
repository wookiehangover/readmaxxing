import { timingSafeEqual } from "node:crypto";
import { sweepReadingIngestQueues } from "~/lib/reading-agent/dispatch.server";

export async function loader({ request }: { request: Request }): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !secretsMatch(provided, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const swept = await sweepReadingIngestQueues();
  return Response.json({ swept });
}

function secretsMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  const compareBuffer = Buffer.alloc(expectedBuffer.length);
  actualBuffer.copy(compareBuffer, 0, 0, expectedBuffer.length);
  return (
    timingSafeEqual(compareBuffer, expectedBuffer) && actualBuffer.length === expectedBuffer.length
  );
}
