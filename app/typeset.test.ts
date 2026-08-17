import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const typesetCss = readFileSync(resolve(process.cwd(), "app/typeset.css"), "utf8");

function headingRule(level: number) {
  const match = typesetCss.match(new RegExp(`&:where\\(h${level}\\) \\{([^}]*)\\}`));
  expect(match, `Expected a .typeset h${level} rule`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("rail typeset headings", () => {
  it("uses the quiet editorial scale without changing heading semantics", () => {
    expect(headingRule(1)).toContain("font-size: 1.125em");
    expect(headingRule(1)).toContain("font-weight: 500");
    expect(headingRule(2)).toContain("font-size: 1em");
    expect(headingRule(2)).toContain("font-weight: 500");
    expect(headingRule(3)).toContain("font-size: 0.9375em");
    expect(headingRule(4)).toContain("font-size: 0.875em");
    expect(headingRule(5)).toContain("font-size: 0.875em");
    expect(headingRule(6)).toContain("font-size: 0.8125em");
  });
});
