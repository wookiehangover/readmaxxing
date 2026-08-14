import { createFlueClient } from "@flue/sdk";

export type ArtifactKind = "outline" | "characters" | "wiki";
export type ReadingScribeResult = Record<
  ArtifactKind,
  { status: "unchanged" | "updated"; body: string; summary: string }
>;

const ARTIFACT_KINDS: ArtifactKind[] = ["outline", "characters", "wiki"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseReadingScribeResult(value: unknown): ReadingScribeResult {
  if (!isRecord(value)) throw new Error("ReadingScribe returned a non-object result");
  const result = {} as ReadingScribeResult;
  for (const kind of ARTIFACT_KINDS) {
    const edit = value[kind];
    if (
      !isRecord(edit) ||
      (edit.status !== "unchanged" && edit.status !== "updated") ||
      typeof edit.body !== "string" ||
      typeof edit.summary !== "string" ||
      edit.summary.trim().length === 0
    ) {
      throw new Error(`ReadingScribe returned an invalid ${kind} edit`);
    }
    result[kind] = {
      status: edit.status,
      body: edit.body,
      summary: edit.summary.trim().slice(0, 160),
    };
  }
  return result;
}

export async function callReadingScribe(options: {
  url: string;
  secret: string;
  page: string;
  artifacts: Record<ArtifactKind, string>;
}): Promise<ReadingScribeResult> {
  const client = createFlueClient({ url: options.url, token: options.secret });
  const admission = await client.send({
    message: {
      kind: "user",
      body: JSON.stringify({ page: options.page, artifacts: options.artifacts }),
    },
  });
  const reply = await client.read(admission);
  try {
    return parseReadingScribeResult(JSON.parse(reply.text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("ReadingScribe reply was not valid JSON");
    throw error;
  }
}
