import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const indexHtmlPath = resolve("build/client/index.html");
const serviceWorkerPath = resolve("build/client/sw.js");

const indexHtmlPrecacheEntryPatterns = [
  /\{\s*("?url"?)\s*:\s*"\/index\.html"\s*,\s*("?revision"?)\s*:\s*(?:null|"[a-f0-9]+")\s*\}/,
  /\{\s*("?revision"?)\s*:\s*(?:null|"[a-f0-9]+")\s*,\s*("?url"?)\s*:\s*"\/index\.html"\s*\}/,
];

const indexHtml = await readFile(indexHtmlPath);
const revision = createHash("sha256").update(indexHtml).digest("hex");
const serviceWorker = await readFile(serviceWorkerPath, "utf8");

const patchedServiceWorker = serviceWorker
  .replace(indexHtmlPrecacheEntryPatterns[0], (_entry, urlKey, revisionKey) => {
    return `{${urlKey}:"/index.html",${revisionKey}:"${revision}"}`;
  })
  .replace(indexHtmlPrecacheEntryPatterns[1], (_entry, revisionKey, urlKey) => {
    return `{${revisionKey}:"${revision}",${urlKey}:"/index.html"}`;
  });

if (patchedServiceWorker === serviceWorker) {
  const alreadyPatched =
    indexHtmlPrecacheEntryPatterns.some((pattern) => pattern.test(serviceWorker)) &&
    serviceWorker.includes(`"${revision}"`);
  if (!alreadyPatched) {
    throw new Error("Unable to patch /index.html precache revision in build/client/sw.js");
  }
  console.log(`SW /index.html revision already set (${revision.slice(0, 12)}…)`);
  process.exit(0);
}

await writeFile(serviceWorkerPath, patchedServiceWorker);
console.log(`Patched SW /index.html revision ${revision.slice(0, 12)}…`);
