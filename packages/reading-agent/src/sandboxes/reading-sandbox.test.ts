import { describe, expect, it } from "vitest";
import { shouldUseVercelReadingSandbox } from "./reading-sandbox";

describe("reading sandbox selection", () => {
  it("uses the memory sandbox outside production even when OIDC is available", () => {
    expect(
      shouldUseVercelReadingSandbox({
        NODE_ENV: "development",
        VERCEL_OIDC_TOKEN: "available",
      }),
    ).toBe(false);
  });

  it.each([
    {
      environment: { NODE_ENV: "production", VERCEL_OIDC_TOKEN: "available" },
      credentials: "OIDC",
    },
    {
      environment: {
        VERCEL_ENV: "production",
        VERCEL_TOKEN: "available",
        VERCEL_PROJECT_ID: "project",
        VERCEL_TEAM_ID: "team",
      },
      credentials: "access token",
    },
  ])("uses the Vercel sandbox in production with $credentials credentials", ({ environment }) => {
    expect(shouldUseVercelReadingSandbox(environment)).toBe(true);
  });

  it("uses the memory sandbox in production without Vercel credentials", () => {
    expect(shouldUseVercelReadingSandbox({ NODE_ENV: "production" })).toBe(false);
  });
});
