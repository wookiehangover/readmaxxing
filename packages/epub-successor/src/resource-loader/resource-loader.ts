import { inflate } from "fflate";

import type { PublicationPath } from "../publication-model/paths";
import {
  DEFAULT_ZIP_SECURITY_LIMITS,
  ResourceNotFoundError,
  ResourceProviderClosedError,
  ResourceProviderError,
  ResourceReadAbortedError,
  ZipFormatError,
  type ZipSecurityLimits,
} from "./resource-provider-errors";
import {
  assertOutput,
  checkedLimits,
  normalizeEntryPath,
  parseEntries,
  type ZipEntry,
} from "./zip-archive";

export {
  DEFAULT_ZIP_SECURITY_LIMITS,
  ResourceNotFoundError,
  ResourceProviderClosedError,
  ResourceProviderError,
  ResourceReadAbortedError,
  ZipEntryPathError,
  ZipFormatError,
  ZipLimitError,
} from "./resource-provider-errors";
export type { ResourceProviderErrorCode, ZipSecurityLimits } from "./resource-provider-errors";

export interface ResourceProvider {
  has(path: string): boolean;
  read(path: string, signal?: AbortSignal): Promise<Uint8Array>;
  readText(path: string, signal?: AbortSignal): Promise<string>;
  entries(): readonly PublicationPath[];
  close(): void;
}

export type ZipResourceSource = ArrayBuffer | Blob | File | URL;

type ZipFetch = (input: URL, init: { signal?: AbortSignal }) => Promise<Response>;

export interface OpenZipResourceProviderOptions {
  readonly limits?: Partial<ZipSecurityLimits>;
  readonly signal?: AbortSignal;
  readonly fetch?: ZipFetch;
}

interface ActiveRead {
  cancel(error: ResourceProviderError): void;
}

export class ZipResourceProvider implements ResourceProvider {
  readonly #activeReads = new Set<ActiveRead>();
  #bytes: Uint8Array | undefined;
  #entries: Map<PublicationPath, ZipEntry> | undefined;

  constructor(
    bytes: Uint8Array,
    readonly limits: ZipSecurityLimits = DEFAULT_ZIP_SECURITY_LIMITS,
  ) {
    this.#bytes = bytes;
    this.#entries = parseEntries(bytes, limits);
  }

  has(path: string): boolean {
    this.#assertOpen();
    return this.#entries!.has(normalizeEntryPath(path, false));
  }

  read(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    this.#assertOpen();
    if (signal?.aborted) return Promise.reject(new ResourceReadAbortedError());
    const normalized = normalizeEntryPath(path, false);
    const entry = this.#entries!.get(normalized);
    if (!entry) return Promise.reject(new ResourceNotFoundError(normalized));
    const compressed = this.#bytes!.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressedSize,
    );
    return entry.compressionMethod === 0
      ? this.#readStored(entry, compressed, signal)
      : this.#readDeflated(entry, compressed, signal);
  }

  async readText(path: string, signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode(await this.read(path, signal));
  }

  entries(): readonly PublicationPath[] {
    this.#assertOpen();
    return [...this.#entries!.keys()];
  }

  close(): void {
    if (!this.#bytes) return;
    this.#bytes = undefined;
    this.#entries?.clear();
    this.#entries = undefined;
    for (const read of this.#activeReads) read.cancel(new ResourceProviderClosedError());
    this.#activeReads.clear();
  }

  #assertOpen(): void {
    if (!this.#bytes || !this.#entries) throw new ResourceProviderClosedError();
  }

  #readStored(entry: ZipEntry, compressed: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: ResourceProviderError) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.#activeReads.delete(active);
        if (error) reject(error);
        else {
          const output = compressed.slice();
          try {
            assertOutput(entry, output, this.limits);
            resolve(output);
          } catch (cause) {
            reject(cause);
          }
        }
      };
      const onAbort = () => finish(new ResourceReadAbortedError());
      const active: ActiveRead = { cancel: finish };
      this.#activeReads.add(active);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else queueMicrotask(() => finish());
    });
  }

  #readDeflated(
    entry: ZipEntry,
    compressed: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let terminate = () => {};
      const finish = (error?: ResourceProviderError, output?: Uint8Array) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        this.#activeReads.delete(active);
        if (error) reject(error);
        else if (output) resolve(output);
      };
      const onAbort = () => {
        terminate();
        finish(new ResourceReadAbortedError());
      };
      const active: ActiveRead = {
        cancel(error) {
          terminate();
          finish(error);
        },
      };
      this.#activeReads.add(active);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) return onAbort();
      try {
        terminate = inflate(compressed, { size: entry.uncompressedSize }, (error, output) => {
          if (error) {
            finish(
              new ZipFormatError("INVALID_ZIP", "ZIP entry decompression failed", { cause: error }),
            );
            return;
          }
          try {
            assertOutput(entry, output, this.limits);
            finish(undefined, output);
          } catch (cause) {
            finish(
              cause instanceof ResourceProviderError
                ? cause
                : new ZipFormatError("INVALID_ZIP", "ZIP entry validation failed", { cause }),
            );
          }
        });
      } catch (cause) {
        finish(new ZipFormatError("INVALID_ZIP", "ZIP entry decompression failed", { cause }));
      }
    });
  }
}

async function readSource(
  source: ZipResourceSource,
  signal: AbortSignal | undefined,
  fetcher: ZipFetch | undefined,
): Promise<Uint8Array> {
  if (signal?.aborted) throw new ResourceReadAbortedError();
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (source instanceof URL) {
    try {
      const response = await (fetcher ?? globalThis.fetch)(source, { signal });
      if (!response.ok)
        throw new ResourceProviderError("FETCH_FAILED", "ZIP fetch was unsuccessful");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (signal?.aborted) throw new ResourceReadAbortedError();
      return bytes;
    } catch (cause) {
      if (cause instanceof ResourceProviderError) throw cause;
      if (signal?.aborted) throw new ResourceReadAbortedError();
      throw new ResourceProviderError("FETCH_FAILED", "ZIP fetch failed", { cause });
    }
  }
  try {
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (signal?.aborted) throw new ResourceReadAbortedError();
    return bytes;
  } catch (cause) {
    if (cause instanceof ResourceProviderError) throw cause;
    throw new ResourceProviderError("FETCH_FAILED", "ZIP source could not be read", { cause });
  }
}

export async function openZipResourceProvider(
  source: ZipResourceSource,
  options: OpenZipResourceProviderOptions = {},
): Promise<ZipResourceProvider> {
  const limits = checkedLimits(options.limits);
  const bytes = await readSource(source, options.signal, options.fetch);
  if (options.signal?.aborted) throw new ResourceReadAbortedError();
  return new ZipResourceProvider(bytes, limits);
}
