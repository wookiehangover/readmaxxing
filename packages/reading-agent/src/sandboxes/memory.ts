import { posix } from "node:path";
import type { FileStat, Sandbox } from "@flue/runtime";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createMemorySandbox(): Sandbox {
  const cwd = "/workspace";
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>(["/", cwd]);
  const resolvePath = (path: string) => posix.resolve(cwd, path);

  function addParents(path: string) {
    let parent = posix.dirname(path);
    while (!directories.has(parent)) {
      directories.add(parent);
      parent = posix.dirname(parent);
    }
  }

  function requireFile(path: string) {
    const resolved = resolvePath(path);
    const value = files.get(resolved);
    if (!value) throw new Error(`File not found: ${resolved}`);
    return value;
  }

  return {
    cwd,
    resolvePath,
    async readFile(path) {
      return decoder.decode(requireFile(path));
    },
    async readFileBuffer(path) {
      return requireFile(path);
    },
    async writeFile(path, content) {
      const resolved = resolvePath(path);
      addParents(resolved);
      files.set(resolved, typeof content === "string" ? encoder.encode(content) : content);
    },
    async stat(path): Promise<FileStat> {
      const resolved = resolvePath(path);
      const file = files.get(resolved);
      if (file) return { isFile: true, isDirectory: false, size: file.byteLength };
      if (directories.has(resolved)) return { isFile: false, isDirectory: true };
      throw new Error(`Path not found: ${resolved}`);
    },
    async readdir(path) {
      const resolved = resolvePath(path);
      if (!directories.has(resolved)) throw new Error(`Directory not found: ${resolved}`);
      const entries = new Set<string>();
      for (const candidate of [...files.keys(), ...directories]) {
        if (candidate !== resolved && posix.dirname(candidate) === resolved) {
          entries.add(posix.basename(candidate));
        }
      }
      return [...entries].sort();
    },
    async exists(path) {
      const resolved = resolvePath(path);
      return files.has(resolved) || directories.has(resolved);
    },
    async mkdir(path, options) {
      const resolved = resolvePath(path);
      const parent = posix.dirname(resolved);
      if (!options?.recursive && !directories.has(parent)) {
        throw new Error(`Directory not found: ${parent}`);
      }
      addParents(resolved);
      directories.add(resolved);
    },
    async rm(path, options) {
      const resolved = resolvePath(path);
      if (!files.has(resolved) && !directories.has(resolved)) {
        if (options?.force) return;
        throw new Error(`Path not found: ${resolved}`);
      }
      const descendants = [...files.keys(), ...directories].filter((candidate) =>
        candidate.startsWith(`${resolved}/`),
      );
      if (descendants.length > 0 && !options?.recursive) {
        throw new Error(`Directory is not empty: ${resolved}`);
      }
      files.delete(resolved);
      directories.delete(resolved);
      for (const descendant of descendants) {
        files.delete(descendant);
        directories.delete(descendant);
      }
    },
    async exec() {
      return { stdout: "", stderr: "Commands are unavailable in the memory sandbox.", exitCode: 1 };
    },
  };
}
