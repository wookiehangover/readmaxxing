import { describe, expect, it } from "vitest";

import { clientLoader } from "~/routes/workspace";
import { clientLoader as missingBookClientLoader } from "~/routes/books";

function getRedirect(loader: () => unknown): Response {
  try {
    loader();
  } catch (cause) {
    return cause as Response;
  }
  throw new Error("Expected route loader to redirect");
}

describe("WorkspaceRedirectRoute", () => {
  it("redirects the root route to the library", () => {
    const response = getRedirect(clientLoader);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/library");
  });

  it("redirects a missing book id to the library", () => {
    const response = getRedirect(missingBookClientLoader);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/library");
  });
});
