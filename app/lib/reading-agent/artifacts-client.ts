export type ReadingArtifactKind = "outline" | "characters" | "wiki";

export interface ReadingArtifactHead {
  readonly content: string;
  readonly revisionId: string;
  readonly updatedAt: string;
}

export interface ReadingArtifactsResponse {
  readonly bookId: string;
  readonly artifacts: Record<ReadingArtifactKind, ReadingArtifactHead | null>;
}

export type ReadingArtifactsErrorCode =
  | "auth_required"
  | "not_found"
  | "unavailable"
  | "invalid_response"
  | "request_failed";

export class ReadingArtifactsError extends Error {
  readonly name = "ReadingArtifactsError";

  constructor(
    readonly code: ReadingArtifactsErrorCode,
    readonly status: number,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

const ARTIFACT_KINDS: ReadingArtifactKind[] = ["outline", "characters", "wiki"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function parseArtifactHead(value: unknown, kind: ReadingArtifactKind): ReadingArtifactHead | null {
  if (value == null) return null;
  if (
    !isRecord(value) ||
    typeof value.content !== "string" ||
    typeof value.revisionId !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    throw new ReadingArtifactsError(
      "invalid_response",
      200,
      `Invalid ${kind} artifact in reading artifacts response`,
    );
  }
  return {
    content: value.content,
    revisionId: value.revisionId,
    updatedAt: value.updatedAt,
  };
}

export function parseReadingArtifactsResponse(value: unknown): ReadingArtifactsResponse {
  if (!isRecord(value) || typeof value.bookId !== "string" || !isRecord(value.artifacts)) {
    throw new ReadingArtifactsError("invalid_response", 200, "Invalid reading artifacts response");
  }

  const artifacts = {} as Record<ReadingArtifactKind, ReadingArtifactHead | null>;
  for (const kind of ARTIFACT_KINDS) {
    artifacts[kind] = parseArtifactHead(value.artifacts[kind], kind);
  }
  return { bookId: value.bookId, artifacts };
}

export async function fetchReadingArtifacts(
  bookId: string,
  init?: RequestInit,
): Promise<ReadingArtifactsResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/books/${encodeURIComponent(bookId)}/artifacts`, {
      credentials: "include",
      ...init,
    });
  } catch (cause) {
    if (isAbortError(cause)) throw cause;
    throw new ReadingArtifactsError("request_failed", 0, "Failed to load reading artifacts", cause);
  }

  if (response.status === 401) {
    throw new ReadingArtifactsError("auth_required", 401, "Authentication required");
  }
  if (response.status === 404) {
    throw new ReadingArtifactsError("not_found", 404, "Book not found");
  }
  if (response.status === 503) {
    throw new ReadingArtifactsError("unavailable", 503, "Sync not configured");
  }
  if (!response.ok) {
    throw new ReadingArtifactsError(
      "request_failed",
      response.status,
      `Failed to load reading artifacts (${response.status})`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ReadingArtifactsError(
      "invalid_response",
      response.status,
      "Invalid reading artifacts response",
      cause,
    );
  }
  return parseReadingArtifactsResponse(body);
}
