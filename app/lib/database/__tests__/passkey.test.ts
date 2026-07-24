import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());

vi.mock("../pool", () => ({
  getPool: () => ({ query: queryMock }),
}));

import {
  countPasskeysByUserId,
  deletePasskey,
  touchPasskeyLastUsed,
  updatePasskeyName,
} from "../auth/passkey";

type SqlQuery = { _items: Array<{ type: string; value?: unknown }> };

function extractValues(query: SqlQuery): unknown[] {
  return query._items.filter((item) => item.type === "VALUE").map((item) => item.value);
}

beforeEach(() => {
  queryMock.mockReset();
});

describe("passkey management persistence", () => {
  it("deletes a passkey only with its owner id", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(deletePasskey("credential-1", "user-1")).resolves.toBe(true);
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)).toEqual([
      "credential-1",
      "user-1",
    ]);
  });

  it("reports when an owned passkey was not deleted", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(deletePasskey("credential-1", "user-2")).resolves.toBe(false);
  });

  it("updates a passkey name only with its owner id", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(updatePasskeyName("credential-1", "user-1", "Laptop")).resolves.toBe(true);
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)).toEqual([
      "Laptop",
      "credential-1",
      "user-1",
    ]);
  });

  it("allows clearing a passkey name", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(updatePasskeyName("credential-1", "user-1", null)).resolves.toBe(true);
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)[0]).toBeNull();
  });

  it("returns the user's passkey count as a number", async () => {
    queryMock.mockResolvedValue({ rows: [{ count: "2" }], rowCount: 1 });

    await expect(countPasskeysByUserId("user-1")).resolves.toBe(2);
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)).toEqual(["user-1"]);
  });

  it("touches last-used time for an existing credential", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 });

    await expect(touchPasskeyLastUsed("credential-1")).resolves.toBe(true);
    expect(extractValues(queryMock.mock.calls[0][0] as SqlQuery)).toEqual(["credential-1"]);
  });
});
