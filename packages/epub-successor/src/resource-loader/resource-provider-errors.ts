import type { PublicationPath } from "../publication-model/paths";

export interface ZipSecurityLimits {
  readonly maxEntryCount: number;
  readonly maxEntryUncompressedSize: number;
  readonly maxTotalUncompressedSize: number;
  readonly maxCompressionRatio: number;
}

export const DEFAULT_ZIP_SECURITY_LIMITS: ZipSecurityLimits = Object.freeze({
  maxEntryCount: 10_000,
  maxEntryUncompressedSize: 64 * 1024 * 1024,
  maxTotalUncompressedSize: 512 * 1024 * 1024,
  maxCompressionRatio: 100,
});

export type ResourceProviderErrorCode =
  | "ABORTED"
  | "CLOSED"
  | "ENTRY_NOT_FOUND"
  | "FETCH_FAILED"
  | "INVALID_OPTIONS"
  | "INVALID_ZIP"
  | "INVALID_ZIP_PATH"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_ZIP";

export class ResourceProviderError extends Error {
  override readonly name: string = "ResourceProviderError";

  constructor(
    readonly code: ResourceProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ZipFormatError extends ResourceProviderError {
  override readonly name = "ZipFormatError";

  constructor(code: "INVALID_ZIP" | "UNSUPPORTED_ZIP", message: string, options?: ErrorOptions) {
    super(code, message, options);
  }
}

export class ZipEntryPathError extends ResourceProviderError {
  override readonly name = "ZipEntryPathError";

  constructor(options?: ErrorOptions) {
    super("INVALID_ZIP_PATH", "ZIP entry paths must be safe package-relative paths", options);
  }
}

export class ZipLimitError extends ResourceProviderError {
  override readonly name = "ZipLimitError";

  constructor(
    readonly limit: keyof ZipSecurityLimits,
    readonly actual: number,
    readonly maximum: number,
    readonly path?: PublicationPath,
  ) {
    super("LIMIT_EXCEEDED", `ZIP security limit exceeded: ${limit}`);
  }
}

export class ResourceNotFoundError extends ResourceProviderError {
  override readonly name = "ResourceNotFoundError";

  constructor(readonly path: PublicationPath) {
    super("ENTRY_NOT_FOUND", "ZIP entry was not found");
  }
}

export class ResourceProviderClosedError extends ResourceProviderError {
  override readonly name = "ResourceProviderClosedError";

  constructor() {
    super("CLOSED", "Resource provider is closed");
  }
}

export class ResourceReadAbortedError extends ResourceProviderError {
  override readonly name = "ResourceReadAbortedError";

  constructor() {
    super("ABORTED", "Resource read was aborted");
  }
}
