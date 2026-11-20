import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

export function renderHookSimple<T>(hookFn: () => T): T {
  let result: T | undefined;
  function TestComponent() {
    result = hookFn();
    return null;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  flushSync(() => {
    root.render(React.createElement(TestComponent));
  });
  root.unmount();

  if (result === undefined) {
    throw new Error("Hook did not produce a result");
  }
  return result;
}
