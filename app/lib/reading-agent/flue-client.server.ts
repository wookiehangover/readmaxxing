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
      typeof edit.body !== "string"
    ) {
      throw new Error(`ReadingScribe returned an invalid ${kind} edit`);
    }
    const summary = typeof edit.summary === "string" ? edit.summary.trim() : "";
    result[kind] = {
      status: edit.status,
      body: edit.body,
      summary:
        summary.slice(0, 160) ||
        (edit.status === "updated" ? `Updated ${kind}.` : `No ${kind} change.`),
    };
  }
  return result;
}

function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          break;
        }
      }
    }
  }
  throw new SyntaxError("No valid JSON object found");
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
    return parseReadingScribeResult(parseJsonReply(reply.text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("ReadingScribe reply was not valid JSON");
    throw error;
  }
}
