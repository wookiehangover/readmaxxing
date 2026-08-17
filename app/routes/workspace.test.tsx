import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/components/reading-shell", () => ({
  ReadingShell: () => <div data-testid="reading-shell" />,
}));

import WorkspaceRoute from "~/routes/workspace";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("WorkspaceRoute", () => {
  it("mounts the reading shell instead of dockview", () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")));

    act(() => root.render(<WorkspaceRoute />));

    expect(document.body.querySelector("[data-testid='reading-shell']")).not.toBeNull();
    expect(document.body.querySelector(".dv-dockview")).toBeNull();
    act(() => root.unmount());
  });
});
