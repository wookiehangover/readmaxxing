import { sql } from "pg-sql";
import { getPool } from "../pool";
import type { ReadingOutlinePendingPage } from "~/lib/reading-agent/artifacts-client";
import { getOutlineIncrementPage } from "~/lib/reading-agent/outline-merge";

export async function listPendingOutlinePages(
  userId: string,
  bookId: string,
): Promise<ReadingOutlinePendingPage[]> {
  const result = await getPool().query<{
    unitId: string;
    locator: string;
    displayPage: number | null;
    status: "pending" | "processing";
  }>(sql`
    SELECT id AS "unitId", locator, display_page AS "displayPage", status
    FROM readmax.reading_ingest_unit
    WHERE user_id = ${userId}
      AND book_id = ${bookId}
      AND status IN ('pending', 'processing')
    ORDER BY first_seen_at ASC, id ASC
  `);
  return result.rows.map((row) => {
    const page = getOutlineIncrementPage(row);
    return {
      unitId: row.unitId,
      page: page !== null && Number.isSafeInteger(page) && page > 0 ? page : null,
      status: row.status,
    };
  });
}
