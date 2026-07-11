import {
  normalizePublicationPath,
  resolvePublicationPath,
  type PublicationPath,
} from "../publication-model/paths";
import { ResourceReadAbortedError } from "./resource-provider-errors";
import type { ResourceProvider } from "./resource-loader";
import { rewriteCss } from "./css-urls";

export const INTERNAL_LINK_ATTRIBUTE = "data-publication-href";

const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

const MIME_TYPES: Readonly<Record<string, string>> = {
  css: "text/css",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "application/xhtml+xml",
  xml: "application/xml",
};

export interface ResolvedPublicationReference {
  readonly path: PublicationPath;
  readonly suffix: string;
}

export interface ResourceUrlLease {
  readonly path: PublicationPath;
  readonly url: string;
  revoke(): void;
  dispose(): void;
}

interface UrlEntry {
  readonly path: PublicationPath;
  readonly url: string;
  references: number;
}

interface PendingEntry {
  readonly controller: AbortController;
  promise: Promise<UrlEntry>;
  waiters: number;
  settled: boolean;
}

export type ResourceMediaTypes =
  | ReadonlyMap<PublicationPath, string>
  | ((path: PublicationPath) => string | undefined);

export function mediaTypeForPath(path: PublicationPath): string {
  const barePath = splitSuffix(path)[0];
  const extension = barePath.slice(barePath.lastIndexOf(".") + 1).toLowerCase();
  return MIME_TYPES[extension] ?? "application/octet-stream";
}

function splitSuffix(value: string): readonly [path: string, suffix: string] {
  const indexes = [value.indexOf("?"), value.indexOf("#")].filter((index) => index >= 0);
  const start = indexes.length === 0 ? value.length : Math.min(...indexes);
  return [value.slice(0, start), value.slice(start)];
}

export function resolvePublicationReference(
  base: PublicationPath,
  reference: string,
): ResolvedPublicationReference | undefined {
  const value = reference.trim();
  if (value === "" || value.startsWith("//") || SCHEME.test(value)) return undefined;
  const resolved = resolvePublicationPath(base, value);
  const [path, suffix] = splitSuffix(resolved);
  return { path: normalizePublicationPath(path), suffix };
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new ResourceReadAbortedError());
    else
      signal.addEventListener("abort", () => reject(new ResourceReadAbortedError()), {
        once: true,
      });
  });
}

export class ResourceUrlManager {
  readonly #entries = new Map<string, UrlEntry>();
  readonly #pending = new Map<string, PendingEntry>();
  #disposed = false;

  constructor(
    readonly provider: ResourceProvider,
    readonly mediaTypes?: ResourceMediaTypes,
  ) {}

  createScope(): ResourceUrlScope {
    this.#assertOpen();
    return new ResourceUrlScope(this);
  }

  async acquire(
    path: PublicationPath,
    mediaType?: string,
    signal?: AbortSignal,
  ): Promise<ResourceUrlLease> {
    const normalized = normalizePublicationPath(splitSuffix(path)[0]);
    const type = mediaType ?? this.#mediaType(normalized);
    const key = `resource\0${normalized}\0${type}`;
    return this.#acquire(
      key,
      normalized,
      type,
      (readSignal) => this.provider.read(normalized, readSignal),
      signal,
    );
  }

  async acquireGenerated(
    key: string,
    path: PublicationPath,
    contents: string,
    mediaType: string,
    signal?: AbortSignal,
  ): Promise<ResourceUrlLease> {
    return this.#acquire(
      `generated\0${key}\0${mediaType}`,
      path,
      mediaType,
      async () => new TextEncoder().encode(contents),
      signal,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const pending of this.#pending.values()) pending.controller.abort();
    this.#pending.clear();
    for (const entry of this.#entries.values()) URL.revokeObjectURL(entry.url);
    this.#entries.clear();
  }

  async #acquire(
    key: string,
    path: PublicationPath,
    mediaType: string,
    read: (signal: AbortSignal) => Promise<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<ResourceUrlLease> {
    this.#assertOpen();
    if (signal?.aborted) throw new ResourceReadAbortedError();
    const existing = this.#entries.get(key);
    if (existing) return this.#lease(key, existing);

    let pending = this.#pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const created: PendingEntry = {
        controller,
        waiters: 0,
        settled: false,
        promise: Promise.resolve(undefined as never),
      };
      created.promise = read(controller.signal)
        .then((bytes) => {
          if (controller.signal.aborted || this.#disposed) throw new ResourceReadAbortedError();
          const buffer = bytes.slice().buffer;
          const entry = {
            path,
            url: URL.createObjectURL(new Blob([buffer], { type: mediaType })),
            references: 0,
          };
          this.#entries.set(key, entry);
          return entry;
        })
        .finally(() => {
          created.settled = true;
          this.#pending.delete(key);
        });
      pending = created;
      this.#pending.set(key, pending);
    }

    pending.waiters += 1;
    let acquired = false;
    try {
      const entry = signal
        ? await Promise.race([pending.promise, abortPromise(signal)])
        : await pending.promise;
      if (signal?.aborted) throw new ResourceReadAbortedError();
      acquired = true;
      return this.#lease(key, entry);
    } finally {
      pending.waiters -= 1;
      if (!acquired && pending.waiters === 0 && !pending.settled) pending.controller.abort();
      const orphan = this.#entries.get(key);
      if (!acquired && pending.waiters === 0 && orphan?.references === 0) {
        URL.revokeObjectURL(orphan.url);
        this.#entries.delete(key);
      }
    }
  }

  #lease(key: string, entry: UrlEntry): ResourceUrlLease {
    entry.references += 1;
    let active = true;
    const dispose = () => {
      if (!active) return;
      active = false;
      const current = this.#entries.get(key);
      if (!current || current.url !== entry.url) return;
      current.references -= 1;
      if (current.references === 0) {
        URL.revokeObjectURL(current.url);
        this.#entries.delete(key);
      }
    };
    return { path: entry.path, url: entry.url, revoke: dispose, dispose };
  }

  #mediaType(path: PublicationPath): string {
    return typeof this.mediaTypes === "function"
      ? (this.mediaTypes(path) ?? mediaTypeForPath(path))
      : (this.mediaTypes?.get(path) ?? mediaTypeForPath(path));
  }

  #assertOpen(): void {
    if (this.#disposed) throw new Error("ResourceUrlManager is disposed");
  }
}

export class ResourceUrlScope {
  readonly #leases = new Map<string, ResourceUrlLease>();
  #disposed = false;

  constructor(readonly manager: ResourceUrlManager) {}

  async resourceUrl(
    reference: string,
    base: PublicationPath,
    signal?: AbortSignal,
  ): Promise<string> {
    if (reference.trim().startsWith("#")) return reference;
    const resolved = resolvePublicationReference(base, reference);
    if (!resolved) return reference;
    const lease = await this.#own(`resource\0${resolved.path}`, () =>
      this.manager.acquire(resolved.path, undefined, signal),
    );
    return `${lease.url}${resolved.suffix}`;
  }

  async stylesheetUrl(
    reference: string,
    base: PublicationPath,
    signal?: AbortSignal,
    ancestors: ReadonlySet<PublicationPath> = new Set(),
  ): Promise<string> {
    const resolved = resolvePublicationReference(base, reference);
    if (!resolved) return reference;
    if (ancestors.has(resolved.path)) {
      const cycle = await this.#generated(`cycle:${resolved.path}`, resolved.path, "", signal);
      return `${cycle}${resolved.suffix}`;
    }
    const nextAncestors = new Set(ancestors).add(resolved.path);
    const css = await this.manager.provider.readText(resolved.path, signal);
    const rewritten = await rewriteCss(css, resolved.path, this, signal, nextAncestors);
    const url = await this.#generated(
      `stylesheet:${resolved.path}`,
      resolved.path,
      rewritten,
      signal,
    );
    return `${url}${resolved.suffix}`;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const leases = [...this.#leases.values()].reverse();
    this.#leases.clear();
    for (const lease of leases) lease.dispose();
  }

  revoke(): void {
    this.dispose();
  }

  async #generated(
    key: string,
    path: PublicationPath,
    contents: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const lease = await this.#own(`generated\0${key}`, () =>
      this.manager.acquireGenerated(key, path, contents, "text/css", signal),
    );
    return lease.url;
  }

  async #own(key: string, acquire: () => Promise<ResourceUrlLease>): Promise<ResourceUrlLease> {
    if (this.#disposed) throw new Error("ResourceUrlScope is disposed");
    const existing = this.#leases.get(key);
    if (existing) return existing;
    const lease = await acquire();
    if (this.#disposed) {
      lease.dispose();
      throw new Error("ResourceUrlScope is disposed");
    }
    const raced = this.#leases.get(key);
    if (raced) {
      lease.dispose();
      return raced;
    }
    this.#leases.set(key, lease);
    return lease;
  }
}

function parseSrcset(value: string): Array<{ url: string; descriptor: string }> {
  const candidates: Array<{ url: string; descriptor: string }> = [];
  let index = 0;
  while (index < value.length) {
    while (/[\s,]/.test(value[index] ?? "")) index += 1;
    if (index >= value.length) break;
    const start = index;
    const isData = value.slice(index, index + 5).toLowerCase() === "data:";
    while (index < value.length && !/\s/.test(value[index]!) && (isData || value[index] !== ","))
      index += 1;
    const url = value.slice(start, index).replace(/,$/, "");
    const descriptorStart = index;
    while (index < value.length && value[index] !== ",") index += 1;
    candidates.push({ url, descriptor: value.slice(descriptorStart, index).trim() });
    index += 1;
  }
  return candidates;
}

async function rewriteSrcset(
  value: string,
  base: PublicationPath,
  scope: ResourceUrlScope,
  signal?: AbortSignal,
): Promise<string> {
  const candidates = await Promise.all(
    parseSrcset(value).map(async ({ url, descriptor }) => ({
      url: await scope.resourceUrl(url, base, signal),
      descriptor,
    })),
  );
  return candidates
    .map(({ url, descriptor }) => `${url}${descriptor ? ` ${descriptor}` : ""}`)
    .join(", ");
}

export async function rewriteXhtml(
  xhtml: string,
  base: PublicationPath,
  scope: ResourceUrlScope,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new ResourceReadAbortedError();
  const document = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Cannot rewrite malformed XHTML");
  }
  const rewrites: Array<Promise<void>> = [];
  for (const element of document.querySelectorAll("*")) {
    const name = element.localName.toLowerCase();
    const rewrite = (attribute: string, stylesheet = false) => {
      const value = element.getAttribute(attribute);
      if (value === null) return;
      rewrites.push(
        (stylesheet
          ? scope.stylesheetUrl(value, base, signal)
          : scope.resourceUrl(value, base, signal)
        ).then((url) => element.setAttribute(attribute, url)),
      );
    };
    if (name === "img") rewrite("src");
    if (
      name === "link" &&
      element.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("stylesheet")
    )
      rewrite("href", true);
    if (name === "source") rewrite("src");
    if (name === "img" || name === "source") {
      const srcset = element.getAttribute("srcset");
      if (srcset !== null)
        rewrites.push(
          rewriteSrcset(srcset, base, scope, signal).then((value) =>
            element.setAttribute("srcset", value),
          ),
        );
    }
    if (name === "object") rewrite("data");
    if (name === "audio" || name === "video") rewrite("src");
    if (name === "image") {
      rewrite("href");
      const value = element.getAttributeNS(XLINK_NAMESPACE, "href");
      if (value !== null)
        rewrites.push(
          scope
            .resourceUrl(value, base, signal)
            .then((url) => element.setAttributeNS(XLINK_NAMESPACE, "xlink:href", url)),
        );
    }
    if (name === "a") {
      const href = element.getAttribute("href");
      if (href !== null) {
        const resolved = resolvePublicationReference(base, href);
        if (resolved) {
          element.setAttribute(INTERNAL_LINK_ATTRIBUTE, `${resolved.path}${resolved.suffix}`);
          element.setAttribute("href", "#");
        }
      }
    }
  }
  await Promise.all(rewrites);
  if (signal?.aborted) throw new ResourceReadAbortedError();
  return new XMLSerializer().serializeToString(document);
}
