import { describe, expect, it } from "vitest";
import * as v from "valibot";
import {
  ReadingScribeResultSchema,
  mergeReadingScribeResult,
  updatedArtifactKinds,
  type CurrentArtifacts,
  type ReadingScribeResult,
} from "./result";

const current: CurrentArtifacts = {
  outline: "- Alice enters the garden.",
  characters: "## Alice\n- A curious visitor.",
  wiki: "Alice has entered a strange garden.",
};

function unchanged(body: string): ReadingScribeResult["outline"] {
  return { status: "unchanged", body, summary: "The page adds nothing for this artifact." };
}

describe("ReadingScribe result", () => {
  it("keeps explicit no-ops and exposes only materially updated kinds", () => {
    const result = mergeReadingScribeResult(current, {
      outline: unchanged("A model rewrite that must be ignored."),
      characters: unchanged(current.characters),
      wiki: {
        status: "updated",
        body: "Alice has entered a strange garden and found a locked door.",
        summary: "Added the locked door Alice encounters.",
      },
    });

    expect(result.outline).toEqual({
      status: "unchanged",
      body: current.outline,
      summary: "The page adds nothing for this artifact.",
    });
    expect(updatedArtifactKinds(result)).toEqual(["wiki"]);
  });

  it("downgrades an updated label when the markdown did not change", () => {
    const result = mergeReadingScribeResult(current, {
      outline: {
        status: "updated",
        body: `  ${current.outline}\n`,
        summary: "Reformatted the same event.",
      },
      characters: unchanged(current.characters),
      wiki: unchanged(current.wiki),
    });

    expect(result.outline).toEqual({
      status: "unchanged",
      body: current.outline,
      summary: "No material change to the existing artifact.",
    });
  });

  it("rejects implicit or invalid statuses", () => {
    const parsed = v.safeParse(ReadingScribeResultSchema, {
      outline: { body: current.outline, summary: "No change." },
      characters: { status: "skipped", body: current.characters, summary: "No change." },
      wiki: unchanged(current.wiki),
    });

    expect(parsed.success).toBe(false);
  });
});
