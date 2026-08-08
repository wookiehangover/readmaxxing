import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const outletContext = vi.hoisted(() => ({
  current: {
    onDockviewReady: vi.fn(),
    onDockviewDispose: vi.fn(),
  },
}));

vi.mock("dockview-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("dockview-react")>()),
  DockviewReact: () => null,
}));

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useOutletContext: () => outletContext.current,
}));

import WorkspaceRoute from "~/routes/workspace";

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("WorkspaceRoute", () => {
  it("uses the latest dispose callback only when the route unmounts", () => {
    const firstDispose = vi.fn();
    const latestDispose = vi.fn();
    outletContext.current = { onDockviewReady: vi.fn(), onDockviewDispose: firstDispose };
    const root = createRoot(document.body.appendChild(document.createElement("div")));

    act(() => root.render(<WorkspaceRoute />));
    outletContext.current = { onDockviewReady: vi.fn(), onDockviewDispose: latestDispose };
    act(() => root.render(<WorkspaceRoute />));

    expect(firstDispose).not.toHaveBeenCalled();
    expect(latestDispose).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(latestDispose).toHaveBeenCalledOnce();
  });
});
