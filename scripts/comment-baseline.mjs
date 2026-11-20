import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { DUMP_ENV, DUMP_PREFIX, baselinePath, repoRoot } from "./no-comments-oxlint-plugin.mjs";

const mode = process.argv[2];
if (!["--check", "--update", "--init"].includes(mode)) {
  console.error("Usage: node scripts/comment-baseline.mjs --check | --update | --init");
  process.exit(2);
}

function currentComments() {
  let stdout;
  try {
    stdout = execFileSync(
      resolve(repoRoot, "node_modules/.bin/oxlint"),
      ["--format=json", "-A", "all", "-D", "comments/no-comments", "."],
      {
        cwd: repoRoot,
        env: { ...process.env, [DUMP_ENV]: "1" },
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      },
    );
  } catch (error) {
    stdout = error.stdout;
    if (!stdout) throw error;
  }
  const counts = {};
  for (const diagnostic of JSON.parse(stdout).diagnostics) {
    if (!diagnostic.message.startsWith(DUMP_PREFIX)) continue;
    const file = relative(repoRoot, resolve(repoRoot, diagnostic.filename)).split(sep).join("/");
    const hash = diagnostic.message.slice(DUMP_PREFIX.length);
    counts[file] ??= {};
    counts[file][hash] = (counts[file][hash] ?? 0) + 1;
  }
  return counts;
}

function sorted(counts) {
  const out = {};
  for (const file of Object.keys(counts).sort()) {
    const entries = Object.entries(counts[file]).filter(([, n]) => n > 0);
    if (entries.length)
      out[file] = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
  }
  return out;
}

function total(counts) {
  return Object.values(counts).reduce(
    (sum, file) => sum + Object.values(file).reduce((a, b) => a + b, 0),
    0,
  );
}

const current = currentComments();
const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : {};

if (mode === "--init") {
  writeFileSync(baselinePath, `${JSON.stringify(sorted(current), null, 2)}\n`);
  console.log(`Wrote baseline with ${total(current)} comments.`);
  process.exit(0);
}

const ratcheted = {};
for (const [file, hashes] of Object.entries(previous)) {
  for (const [hash, allowed] of Object.entries(hashes)) {
    const kept = Math.min(allowed, current[file]?.[hash] ?? 0);
    if (kept > 0) (ratcheted[file] ??= {})[hash] = kept;
  }
}
const next = sorted(ratcheted);
const removed = total(previous) - total(next);

if (mode === "--update") {
  writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Baseline now allows ${total(next)} comments (${removed} removed).`);
  process.exit(0);
}

if (removed > 0) {
  console.error(
    `comment-baseline.json allows ${removed} comments that no longer exist. Run \`pnpm comments:baseline\` and commit the result.`,
  );
  process.exit(1);
}
console.log(`Comment baseline is tight (${total(next)} legacy comments left).`);
