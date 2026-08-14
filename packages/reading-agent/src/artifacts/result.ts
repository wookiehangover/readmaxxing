import * as v from "valibot";

export const ARTIFACT_KINDS = ["outline", "characters", "wiki"] as const;

export const CurrentArtifactsSchema = v.object({
  outline: v.string(),
  characters: v.string(),
  wiki: v.string(),
});

const ArtifactEditSchema = v.object({
  status: v.picklist(["unchanged", "updated"]),
  body: v.string(),
  summary: v.pipe(v.string(), v.minLength(1), v.maxLength(160)),
});

export const ReadingScribeResultSchema = v.object({
  outline: ArtifactEditSchema,
  characters: ArtifactEditSchema,
  wiki: ArtifactEditSchema,
});

export type CurrentArtifacts = v.InferOutput<typeof CurrentArtifactsSchema>;
export type ReadingScribeResult = v.InferOutput<typeof ReadingScribeResultSchema>;

export const EMPTY_ARTIFACTS: CurrentArtifacts = {
  outline: "",
  characters: "",
  wiki: "",
};

export function mergeReadingScribeResult(
  current: CurrentArtifacts,
  proposed: ReadingScribeResult,
): ReadingScribeResult {
  return Object.fromEntries(
    ARTIFACT_KINDS.map((kind) => {
      const edit = proposed[kind];
      const materiallyChanged = edit.body.trim() !== current[kind].trim();

      if (edit.status === "unchanged" || !materiallyChanged) {
        return [
          kind,
          {
            status: "unchanged",
            body: current[kind],
            summary:
              edit.status === "updated"
                ? "No material change to the existing artifact."
                : edit.summary,
          },
        ];
      }

      return [kind, { ...edit, body: edit.body.trim() }];
    }),
  ) as ReadingScribeResult;
}

export function updatedArtifactKinds(result: ReadingScribeResult): string[] {
  return ARTIFACT_KINDS.filter((kind) => result[kind].status === "updated");
}
