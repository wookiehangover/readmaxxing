import { sql } from "pg-sql";
import { isCronAuthorized } from "~/lib/database/cron-auth";
import { getPool } from "~/lib/database/pool";
/** Poll from the deployment's independent uptime monitor; this endpoint runs no work. */
export async function loader({ request }: { request: Request }) {
  if (!isCronAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const health = (
    await getPool().query<{
      stalled: boolean;
      growing: boolean;
    }>(sql`SELECT last_start,last_success,oldest_due,processing_errors,
    last_success IS NULL OR last_success<clock_timestamp()-INTERVAL '5 minutes' AS stalled,
    due_growth_ticks>=2 AS growing FROM readmax.sync_delivery_scheduler WHERE id=true`)
  ).rows[0];
  const healthy = health && !health.stalled && !health.growing;
  if (!healthy)
    console.error(
      "Sync delivery requires operational attention",
      health ?? "No successful scheduler tick",
    );
  return Response.json(
    { healthy: Boolean(healthy), health: health ?? null },
    { status: healthy ? 200 : 503 },
  );
}
