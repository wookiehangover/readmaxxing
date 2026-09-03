import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import type { SQLQuery } from "pg-sql";
import type { Page } from "@playwright/test";
import { vi } from "vitest";
import { installReviewFixture, questionText } from "../../../../e2e/helpers/review";

const dependencies = vi.hoisted(() => ({ generate: vi.fn(), query: vi.fn() }));
export const model = dependencies;
vi.mock("~/lib/database/pool", () => ({
  getPool: () => ({
    query: dependencies.query,
    connect: async () => ({ query: dependencies.query, release() {} }),
  }),
}));
vi.mock("ai", () => ({ generateObject: dependencies.generate }));
vi.mock("@ai-sdk/gateway", () => ({ gateway: () => ({ id: "deterministic-review-model" }) }));

import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { loader as session } from "~/routes/api.auth.session";
import { action as upload } from "~/routes/api.books.$bookId.chapters";
import { action as question } from "~/routes/api.reviews.question";
import { action as attempt } from "~/routes/api.reviews.attempts";
import { loader as progress } from "~/routes/api.reviews.progress";

export const users = [
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
];
export const sessions = [
  "00000000-0000-4000-8000-000000000021",
  "00000000-0000-4000-8000-000000000022",
];

/** Actual cookie auth, upload/review routes and SQL; only the pool and AI provider are doubled. */
export async function reviewHttpFixture() {
  const db = new PGlite();
  vi.stubEnv("DATABASE_URL", "postgresql://isolated-test-pool");
  model.query.mockImplementation(async (query: SQLQuery | string, values?: unknown[]) => {
    const result = await db.query(
      typeof query === "string" ? query : query.text,
      typeof query === "string" ? values : query.values,
    );
    return { ...result, rowCount: result.affectedRows };
  });
  for (const path of [
    "database/readmax/core.sql",
    "database/migrations/007-book-chapters-current-upload-id.sql",
    "database/migrations/020-chapter-reviews.sql",
  ])
    await db.exec(await readFile(path, "utf8"));
  for (const [index, user] of users.entries()) {
    await db.query("INSERT INTO readmax.user (id) VALUES ($1)", [user]);
    await db.query(
      "INSERT INTO readmax.session (id,user_id,expires_at) VALUES ($1,$2,NOW()+INTERVAL '1 day')",
      [sessions[index], user],
    );
  }
  model.generate.mockReset().mockImplementation(async ({ schemaName, prompt }) => {
    if (schemaName === "chapter_review_question")
      return {
        object: {
          question:
            questionText +
            " Explain how two details support your interpretation and consider a different reading.",
          rubric: {
            criteria: [
              {
                id: "claim",
                description: "A clear interpretation grounded in the supplied chapter.",
              },
              {
                id: "evidence",
                description: "Two accurate chapter details connected to the interpretation.",
              },
              {
                id: "reasoning",
                description: "Explained reasoning and consideration of a different reading.",
              },
            ],
            passingGuidance: "PRIVATE RUBRIC: accept defensible chapter-grounded interpretations.",
          },
        },
      };
    const { submittedAnswer } = JSON.parse(prompt);
    const verdict = submittedAnswer.startsWith("Strong")
      ? "pass"
      : submittedAnswer.startsWith("Partial")
        ? "needs_work"
        : "fail";
    return {
      object: {
        verdict,
        issues: verdict === "pass" ? [] : ["insufficient_evidence"],
        annotations:
          verdict === "pass"
            ? []
            : [
                {
                  start: 0,
                  // Simulate the offset miscount observed in the live model sample.
                  end: 3,
                  quote: submittedAnswer.slice(0, 4),
                  issue: "insufficient_evidence",
                },
              ],
      },
    };
  });
  const requests: { path: string; status: number; data: unknown }[] = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request(`http://localhost${incoming.url}`, {
        method: incoming.method,
        headers: incoming.headers as Record<string, string>,
        ...(incoming.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      });
      const path = new URL(request.url).pathname;
      let response: Response;
      if (path.endsWith("/chapters")) {
        const bookId = path.split("/")[3];
        const owner = await getSessionFromRequest(request);
        // Fixture seam: sync registration only. Chapter text still goes through the real upload route.
        if (owner)
          await db.query(
            "INSERT INTO readmax.book (id,user_id,format) VALUES ($1,$2,'epub') ON CONFLICT DO NOTHING",
            [bookId, owner.userId],
          );
        response = await upload({ request, params: { bookId } });
      } else if (path.endsWith("/session")) response = await session({ request });
      else if (path.endsWith("/question")) response = await question({ request });
      else if (path.endsWith("/attempts")) response = await attempt({ request });
      else response = await progress({ request });
      const body = await response.text();
      requests.push({ path, status: response.status, data: JSON.parse(body) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(body);
    } catch (error) {
      if (error instanceof Response) {
        outgoing.writeHead(error.status);
        outgoing.end(await error.text());
      } else {
        outgoing.writeHead(500);
        outgoing.end(JSON.stringify({ fixtureError: String(error) }));
      }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    db,
    requests,
    url,
    async attach(page: Page, userIndex: number) {
      await installReviewFixture(page);
      await page.context().addCookies([
        {
          name: "readmax_session",
          value: sessions[userIndex],
          url: process.env.REVIEW_BROWSER_URL!,
        },
      ]);
      for (const pattern of [
        "**/api/auth/session",
        "**/api/books/*/chapters",
        "**/api/reviews/**",
      ]) {
        await page.route(pattern, async (route) => {
          const original = new URL(route.request().url());
          const response = await route.fetch({
            url: `${url}${original.pathname}${original.search}`,
          });
          await route.fulfill({ response });
        });
      }
    },
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
      await db.close();
      vi.unstubAllEnvs();
    },
  };
}
