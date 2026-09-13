// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  generate: vi.fn(),
  log: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: mocks.create } }));
vi.mock("@ai-sdk/gateway", () => ({ gateway: (id: string) => id }));
vi.mock("ai", () => ({
  generateText: mocks.generate,
  stepCountIs: vi.fn(),
  tool: (config: unknown) => config,
}));
vi.mock("./repair-jobs.server", () => ({
  appendRepairDiagnostic: mocks.log,
  finishRepairJob: mocks.finish,
}));
import { runRepairJob } from "./repair-runner.server";

const command = (exitCode = 0, stdout = "Checks passed") => ({
  exitCode,
  stdout: async () => stdout,
  stderr: async () => "",
});
const agent = {
  homeDir: "/home/repair",
  writeFiles: vi.fn(),
  runCommand: vi.fn(),
  readFileToBuffer: vi.fn(),
};
const sandbox = { createUser: vi.fn(), runCommand: vi.fn(), writeFiles: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(sandbox);
  sandbox.createUser.mockResolvedValue(agent);
  sandbox.delete.mockResolvedValue(undefined);
  sandbox.runCommand.mockResolvedValue(command());
  agent.runCommand.mockResolvedValue(command(0, "4"));
  agent.readFileToBuffer.mockResolvedValue(Buffer.from("epub"));
  mocks.generate.mockResolvedValue({ text: "Fixed navigation.", response: { messages: [] } });
});

describe("repair runner", () => {
  it("accepts only the independently checked bytes and always deletes the sandbox", async () => {
    await runRepairJob("job", Buffer.from("original"));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ networkPolicy: "deny-all", persistent: false }),
    );
    expect(sandbox.createUser).toHaveBeenCalledWith("repair");
    expect(sandbox.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          expect.stringContaining("preserve-content.py original.epub candidate.epub"),
        ]),
      }),
    );
    expect(mocks.finish).toHaveBeenCalledWith("job", Buffer.from("epub"), null);
    expect(sandbox.delete).toHaveBeenCalledOnce();
  });

  it("feeds failed rendering back to the agent and refuses an unverified output", async () => {
    sandbox.runCommand.mockResolvedValue(command(1, "Chapter 2 cannot render"));
    sandbox.runCommand.mockResolvedValueOnce(command());
    await runRepairJob("job", Buffer.from("original"));
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.generate.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("Chapter 2 cannot render") }),
      ]),
    );
    expect(mocks.finish).toHaveBeenCalledWith(
      "job",
      null,
      expect.stringContaining("three repair passes"),
    );
    expect(sandbox.delete).toHaveBeenCalledOnce();
  });

  it("reports provider failures and cleans up", async () => {
    mocks.generate.mockRejectedValue(new Error("Provider unavailable"));
    await runRepairJob("job", Buffer.from("original"));
    expect(mocks.finish).toHaveBeenCalledWith("job", null, "Provider unavailable");
    expect(sandbox.delete).toHaveBeenCalledOnce();
  });
});
