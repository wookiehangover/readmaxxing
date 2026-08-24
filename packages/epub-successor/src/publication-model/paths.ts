declare const publicationPathBrand: unique symbol;

export type PublicationPath = string & {
  readonly [publicationPathBrand]: "PublicationPath";
};

export type PublicationPathErrorCode =
  | "ABSOLUTE_PATH"
  | "EMPTY_PATH"
  | "ENCODED_SEPARATOR"
  | "INVALID_PERCENT_ENCODING"
  | "PATH_TRAVERSAL";

export class PublicationPathError extends Error {
  override readonly name = "PublicationPathError";

  constructor(
    readonly code: PublicationPathErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

function splitSuffix(value: string): readonly [path: string, suffix: string] {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const indexes = [query, fragment].filter((index) => index >= 0);
  const suffixStart = indexes.length === 0 ? value.length : Math.min(...indexes);
  return [value.slice(0, suffixStart), value.slice(suffixStart)];
}

function inspectSegment(segment: string): "." | ".." | "name" {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new PublicationPathError(
      "INVALID_PERCENT_ENCODING",
      "Publication paths must contain valid percent encoding",
    );
  }
  if (decoded.includes("/") || decoded.includes("\\")) {
    throw new PublicationPathError(
      "ENCODED_SEPARATOR",
      "Publication paths cannot contain percent-encoded separators",
    );
  }
  if (decoded === "." || decoded === "..") return decoded;
  return "name";
}

function assertRelative(path: string): void {
  if (path.startsWith("/") || SCHEME.test(path)) {
    throw new PublicationPathError("ABSOLUTE_PATH", "Publication paths must be package-relative");
  }
}

function normalizeSegments(
  path: string,
  base: readonly string[],
  canResolveParent: boolean,
): string[] {
  const normalized = [...base];
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "") continue;
    const kind = inspectSegment(segment);
    if (kind === ".") {
      if (segment !== ".") {
        throw new PublicationPathError("PATH_TRAVERSAL", "Encoded dot segments are forbidden");
      }
      continue;
    }
    if (kind === "..") {
      if (segment !== ".." || !canResolveParent || normalized.pop() === undefined) {
        throw new PublicationPathError("PATH_TRAVERSAL", "Publication path escapes its root");
      }
      continue;
    }
    normalized.push(segment);
  }
  return normalized;
}

export function normalizePublicationPath(value: string): PublicationPath {
  const [path, suffix] = splitSuffix(value);
  assertRelative(path);
  const normalized = normalizeSegments(path, [], false).join("/");
  if (normalized === "") {
    throw new PublicationPathError("EMPTY_PATH", "Publication paths cannot be empty");
  }
  return `${normalized}${suffix}` as PublicationPath;
}

export function resolvePublicationPath(base: PublicationPath, reference: string): PublicationPath {
  const [basePath] = splitSuffix(base);
  const [referencePath, suffix] = splitSuffix(reference);
  assertRelative(referencePath);
  if (referencePath === "") return normalizePublicationPath(`${basePath}${suffix}`);

  const baseSegments = basePath.split("/");
  baseSegments.pop();
  const resolved = normalizeSegments(referencePath, baseSegments, true).join("/");
  if (resolved === "") {
    throw new PublicationPathError("EMPTY_PATH", "Publication paths cannot be empty");
  }
  return `${resolved}${suffix}` as PublicationPath;
}
