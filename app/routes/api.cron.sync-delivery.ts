import { sql } from "pg-sql";
import { isCronAuthorized } from "~/lib/database/cron-auth";
import { getPool } from "~/lib/database/pool";
import { processDeliveries } from "~/lib/database/sync-delivery/worker";
export async function loader({ request }: { request: Request }) {
  if (!isCronAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const pool = getPool();
  await pool.query(sql`INSERT INTO readmax.sync_delivery_scheduler(id,last_start) VALUES(true,clock_timestamp())
    ON CONFLICT(id) DO UPDATE SET last_start=EXCLUDED.last_start`);
  try {
    const processed = await processDeliveries();
    const health = await pool.query(sql`UPDATE readmax.sync_delivery_scheduler SET
      due_growth_ticks=CASE WHEN oldest_due IS NOT NULL AND oldest_due=(SELECT min(next_attempt_at) FROM readmax.sync_delivery_receipt WHERE next_attempt_at<=clock_timestamp()) THEN due_growth_ticks+1 ELSE 0 END,
      last_success=clock_timestamp(),
      oldest_due=(SELECT min(next_attempt_at) FROM readmax.sync_delivery_receipt WHERE next_attempt_at<=clock_timestamp())
      WHERE id=true RETURNING last_start,last_success,oldest_due,due_growth_ticks,processing_errors`);
    return Response.json({ processed, health: health.rows[0] });
  } catch (error) {
    await pool.query(
      sql`UPDATE readmax.sync_delivery_scheduler SET processing_errors=processing_errors+1 WHERE id=true`,
    );
    console.error("Sync delivery scheduler failed", error);
    return Response.json({ error: "Delivery processing unavailable" }, { status: 503 });
  }
}
