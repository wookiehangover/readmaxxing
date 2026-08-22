import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceShortcuts } from "~/hooks/use-workspace-shortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots.length = 0;
  document.body.innerHTML = "";
});

describe("useWorkspaceShortcuts", () => {
  it("keeps sidebar collapse and zen mode shortcuts", () => {
    const updateSettings = vi.fn();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    roots.push(root);

    function Harness() {
      useWorkspaceShortcuts({ collapsed: false, zenMode: false, updateSettings });
      return null;
    }

    act(() => root.render(React.createElement(Harness)));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", metaKey: true }));

    expect(updateSettings.mock.calls).toEqual([[{ sidebarCollapsed: true }], [{ zenMode: true }]]);
  });
});
