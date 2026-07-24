// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getPasskeyById: vi.fn(),
  deletePasskeyIfNotLast: vi.fn(),
  updatePasskeyName: vi.fn(),
}));

vi.mock("~/lib/database/auth-middleware", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("~/lib/database/auth/passkey", () => ({
  getPasskeyById: mocks.getPasskeyById,
  deletePasskeyIfNotLast: mocks.deletePasskeyIfNotLast,
  updatePasskeyName: mocks.updatePasskeyName,
}));

import { action } from "~/routes/api.auth.passkeys.$id";

function request(method: "PATCH" | "DELETE", body?: unknown) {
  return new Request("https://example.com/api/auth/passkeys/credential-1", {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function run(method: "PATCH" | "DELETE", body?: unknown) {
  try {
    return await action({ request: request(method, body), params: { id: "credential-1" } });
  } catch (cause) {
    if (cause instanceof Response) return cause;
    throw cause;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = "postgres://configured";
  mocks.requireAuth.mockResolvedValue({ userId: "user-1" });
  mocks.getPasskeyById.mockResolvedValue({ id: "credential-1", userId: "user-1" });
});

describe("passkey rename and delete API", () => {
  it("renames an owned passkey", async () => {
    mocks.updatePasskeyName.mockResolvedValue(true);

    const response = await run("PATCH", { name: "Laptop" });

    expect(response.status).toBe(200);
    expect(mocks.updatePasskeyName).toHaveBeenCalledWith("credential-1", "user-1", "Laptop");
  });

  it("does not rename another user's passkey", async () => {
    mocks.getPasskeyById.mockResolvedValue({ id: "credential-1", userId: "user-2" });

    const response = await run("PATCH", { name: "Mine" });

    expect(response.status).toBe(404);
    expect(mocks.updatePasskeyName).not.toHaveBeenCalled();
  });

  it("rejects an invalid name", async () => {
    const response = await run("PATCH", { name: 42 });

    expect(response.status).toBe(400);
    expect(mocks.updatePasskeyName).not.toHaveBeenCalled();
  });

  it("deletes an owned passkey when another remains", async () => {
    mocks.deletePasskeyIfNotLast.mockResolvedValue("deleted");

    const response = await run("DELETE");

    expect(response.status).toBe(200);
    expect(mocks.deletePasskeyIfNotLast).toHaveBeenCalledWith("credential-1", "user-1");
  });

  it("refuses to delete the user's last passkey", async () => {
    mocks.deletePasskeyIfNotLast.mockResolvedValue("last_passkey");

    const response = await run("DELETE");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Cannot remove the last passkey" });
  });

  it("checks ownership before attempting delete", async () => {
    mocks.getPasskeyById.mockResolvedValue({ id: "credential-1", userId: "user-2" });

    const response = await run("DELETE");

    expect(response.status).toBe(404);
    expect(mocks.deletePasskeyIfNotLast).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.requireAuth.mockRejectedValue(Response.json({ error: "auth_required" }, { status: 401 }));

    const response = await run("DELETE");

    expect(response.status).toBe(401);
    expect(mocks.getPasskeyById).not.toHaveBeenCalled();
  });
});
