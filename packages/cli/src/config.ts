import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_URL = "https://readmaxxing.app";

export interface Config {
  url: string;
  token: string;
}

export function configPath(): string {
  return (
    process.env.READMAXXING_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "readmaxxing", "config.json")
  );
}

export function normalizeUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error("Use HTTPS, or HTTP on localhost for development.");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("--url must be an origin such as https://your-server.example.");
  return url.origin;
}

export function validateToken(token: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token))
    throw new Error("Invalid CLI token. Generate one at /cli on your Readmaxxing server.");
  return token;
}

async function readSavedConfig(): Promise<Partial<Config>> {
  try {
    const saved = JSON.parse(await readFile(configPath(), "utf8"));
    if (!saved || typeof saved.url !== "string" || typeof saved.token !== "string")
      throw new Error("Invalid config structure");
    return saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error("Could not read CLI config. Check READMAXXING_CONFIG.", { cause: error });
  }
  return {};
}

function serverUrl(override: string | undefined, saved: Partial<Config>): string {
  const value = override ?? process.env.READMAXXING_URL ?? saved.url ?? DEFAULT_URL;
  return normalizeUrl(value);
}

export async function loginUrl(override?: string): Promise<string> {
  return serverUrl(override, await readSavedConfig());
}

export async function readConfig(urlOverride?: string): Promise<Config> {
  const saved = await readSavedConfig();
  const url = serverUrl(urlOverride, saved);
  // Never send a saved credential to an overridden server.
  const token = process.env.READMAXXING_TOKEN ?? (saved.url === url ? saved.token : undefined);
  if (!token)
    throw new Error(
      `Not signed in to this server. Run readmaxxing login${url === DEFAULT_URL ? "" : ` --url ${url}`}.`,
    );
  return { url, token: validateToken(token) };
}

export async function saveConfig(config: Config): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
