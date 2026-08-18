import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ToolStepsDetails } from "../chat-tool-steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ToolStepsDetails", () => {
  it("keeps the status flush inside clipped bubble content", () => {
    const container = document.body.appendChild(document.createElement("div"));
    container.className = "overflow-hidden px-3";
    root = createRoot(container);

    act(() =>
      root?.render(
        <ToolStepsDetails
          toolParts={[
            {
              type: "tool-read_chapter",
              state: "output-available",
              input: { chapterTitle: "Individuals" },
              output: { text: "Chapter text" },
            },
          ]}
          reasoningParts={[]}
          resolveBookTitle={() => undefined}
          showBookLabel={false}
        />,
      ),
    );

    const details = container.querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(details.classList.contains("-ml-4")).toBe(false);
    expect(Array.from(details.classList).some((name) => name.startsWith("-ml-"))).toBe(false);
    expect(summary.textContent).toContain("Read chapter → 1 step");
  });
});
