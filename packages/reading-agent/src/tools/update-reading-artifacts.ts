import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import {
  CurrentArtifactsSchema,
  EMPTY_ARTIFACTS,
  ReadingScribeResultSchema,
  mergeReadingScribeResult,
} from "../artifacts/result";
import { ARTIFACT_UPDATE_PROMPT } from "../artifacts/prompt";

const UpdateReadingArtifactsInput = v.object({
  page: v.pipe(v.string(), v.trim(), v.minLength(1)),
  artifacts: v.optional(CurrentArtifactsSchema, EMPTY_ARTIFACTS),
});

export const updateReadingArtifacts = defineTool({
  name: "update_reading_artifacts",
  description:
    "Update outline, characters, and story-so-far from exactly one newly read page and the current artifact bodies. Call once for every ingest message.",
  input: UpdateReadingArtifactsInput,
  output: ReadingScribeResultSchema,
  harness: true,
  async run({ data, harness, signal }) {
    await Promise.all([
      harness.sandbox.writeFile("page.md", data.page),
      harness.sandbox.writeFile("outline.md", data.artifacts.outline),
      harness.sandbox.writeFile("characters.md", data.artifacts.characters),
      harness.sandbox.writeFile("wiki.md", data.artifacts.wiki),
    ]);

    const { data: proposed } = await harness.prompt(ARTIFACT_UPDATE_PROMPT, {
      result: ReadingScribeResultSchema,
      signal,
    });

    return { output: mergeReadingScribeResult(data.artifacts, proposed) };
  },
});
