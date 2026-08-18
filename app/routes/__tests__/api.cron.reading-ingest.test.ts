import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/reading-agent/dispatch.server", () => ({
  sweepReadingIngestQueues: vi.fn(async () => 0),
}));

import { sweepReadingIngestQueues } from "~/lib/reading-agent/dispatch.server";
import { loader } from "~/routes/api.cron.reading-ingest";

const sweepMock = vi.mocked(sweepReadingIngestQueues);
const originalCronSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  sweepMock.mockReset().mockResolvedValue(0);
});

afterEach(() => {
  if (originalCronSecret == null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

function request(token = "cron-secret"): Request {
  return new Request("http://localhost/api/cron/reading-ingest", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("reading ingest cron", () => {
  it("returns 401 when the cron secret is missing or invalid", async () => {
    delete process.env.CRON_SECRET;
    expect((await loader({ request: request() })).status).toBe(401);

    process.env.CRON_SECRET = "cron-secret";
    expect((await loader({ request: request("wrong") })).status).toBe(401);
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("runs the authenticated sweep", async () => {
    sweepMock.mockResolvedValue(2);

    const response = await loader({ request: request() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ swept: 2 });
    expect(sweepMock).toHaveBeenCalledOnce();
  });
});
