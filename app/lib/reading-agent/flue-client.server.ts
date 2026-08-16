import { createFlueClient, type PromptUsage } from "@flue/sdk";
import { createReadingAgentHost } from "./agent-host.server";

export type ArtifactKind = "outline" | "characters" | "wiki";
export type ReadingScribeResult = Record<
  ArtifactKind,
  { status: "unchanged" | "updated"; body: string; summary: string }
>;

export interface ReadingScribeUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costTotal: number;
  model: string | null;
  source: "flue" | "unknown";
}

export interface ReadingScribeCallResult {
  artifacts: ReadingScribeResult;
  usage: ReadingScribeUsage;
}

export class ReadingScribeCallError extends Error {
  constructor(
    message: string,
    readonly usage: ReadingScribeUsage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ReadingScribeCallError";
  }
}

const ARTIFACT_KINDS: ArtifactKind[] = ["outline", "characters", "wiki"];
const TOOL_OUTPUT_NOT_FOUND = Symbol("tool-output-not-found");
export const READING_SCRIBE_READ_TIMEOUT_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUsageNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPromptUsage(value: unknown): value is PromptUsage {
  return (
    isRecord(value) &&
    isUsageNumber(value.input) &&
    isUsageNumber(value.output) &&
    isUsageNumber(value.cacheRead) &&
    isUsageNumber(value.cacheWrite) &&
    isUsageNumber(value.totalTokens) &&
    isRecord(value.cost) &&
    isUsageNumber(value.cost.input) &&
    isUsageNumber(value.cost.output) &&
    isUsageNumber(value.cost.cacheRead) &&
    isUsageNumber(value.cost.cacheWrite) &&
    isUsageNumber(value.cost.total)
  );
}

function usageModel(metadata: Record<string, unknown>): string | null {
  if (typeof metadata.model === "string") return metadata.model;
  if (!isRecord(metadata.model)) return null;
  const { provider, id } = metadata.model;
  return typeof provider === "string" && typeof id === "string" ? `${provider}/${id}` : null;
}

export function unknownReadingScribeUsage(): ReadingScribeUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
    model: null,
    source: "unknown",
  };
}

export function readingScribeUsageFromError(error: unknown): ReadingScribeUsage {
  return error instanceof ReadingScribeCallError ? error.usage : unknownReadingScribeUsage();
}

function extractReadingScribeUsage(metadata: unknown): ReadingScribeUsage {
  if (!isRecord(metadata)) return unknownReadingScribeUsage();
  const usage = isPromptUsage(metadata.usage)
    ? metadata.usage
    : isPromptUsage(metadata)
      ? metadata
      : null;
  if (!usage) return unknownReadingScribeUsage();
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    costTotal: usage.cost.total,
    model: usageModel(metadata),
    source: "flue",
  };
}

export function parseReadingScribeResult(value: unknown): ReadingScribeResult {
  while (isRecord(value) && "output" in value) value = value.output;
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

function lastReadingArtifactsToolOutput(messages: unknown): unknown | typeof TOOL_OUTPUT_NOT_FOUND {
  if (!Array.isArray(messages)) return TOOL_OUTPUT_NOT_FOUND;
  let output: unknown | typeof TOOL_OUTPUT_NOT_FOUND = TOOL_OUTPUT_NOT_FOUND;
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      if (
        isRecord(part) &&
        part.type === "dynamic-tool" &&
        part.toolName === "update_reading_artifacts" &&
        part.state === "output-available"
      ) {
        output = part.output;
      }
    }
  }
  return output;
}

interface ReadingScribeCallOptions {
  conversationId: string;
  secret: string;
  page: string;
  artifacts: Record<ArtifactKind, string>;
  retainHost?: boolean;
}

async function readWithTimeout<T>(read: Promise<T>, abort: () => Promise<unknown>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          try {
            void abort().catch(() => undefined);
          } catch {
            // The timeout must still release the ingest lease when abort fails synchronously.
          }
          reject(
            new ReadingScribeCallError(
              `ReadingScribe stream timed out after ${READING_SCRIBE_READ_TIMEOUT_MS}ms`,
              unknownReadingScribeUsage(),
            ),
          );
        }, READING_SCRIBE_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function callReadingScribe(
  options: ReadingScribeCallOptions,
): Promise<ReadingScribeCallResult> {
  if (!options.conversationId) {
    throw new Error("ReadingScribe conversation id is required for the in-app host");
  }
  const host = await createReadingAgentHost(options.conversationId, options.secret);
  try {
    const client = createFlueClient({
      url: host.url,
      token: options.secret,
      ...(host.fetch ? { fetch: host.fetch } : {}),
    });
    host.registerAbort(() => client.abort());
    const admission = await client.send({
      message: {
        kind: "user",
        body: JSON.stringify({ page: options.page, artifacts: options.artifacts }),
      },
    });
    const reply = await readWithTimeout(client.read(admission), () => client.abort());
    const usage = extractReadingScribeUsage(reply.metadata);
    const toolOutput = await client
      .history()
      .then(({ messages }) => lastReadingArtifactsToolOutput(messages))
      .catch(() => TOOL_OUTPUT_NOT_FOUND);
    try {
      return {
        artifacts: parseReadingScribeResult(
          toolOutput === TOOL_OUTPUT_NOT_FOUND ? parseJsonReply(reply.text) : toolOutput,
        ),
        usage,
      };
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? "ReadingScribe reply was not valid JSON"
          : error instanceof Error
            ? error.message
            : "ReadingScribe returned an invalid result";
      throw new ReadingScribeCallError(message, usage, { cause: error });
    }
  } finally {
    if (!options.retainHost) await host.dispose();
  }
}
