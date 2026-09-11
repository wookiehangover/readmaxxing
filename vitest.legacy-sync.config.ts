import { defineConfig } from "vitest/config";
import { execFile } from "node:child_process";
import { mkdtempSync, symlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
const exec = promisify(execFile);
// Execute the actual shipped producers/consumer, extracted from immutable Git refs.
const frozen = mkdtempSync(path.join(tmpdir(), "readmax-legacy-sync-"));
for (const [name, ref] of Object.entries({
  main: "c8b0e4b92db1e142dd3a44dee2defcef6d16112c",
  baseline: "4fc6cde2e609fb0f768306c8a5994a6529c21a24",
  ...(process.env.LEGACY_SYNC_SERVER_REF ? { server: process.env.LEGACY_SYNC_SERVER_REF } : {}),
})) {
  const directory = path.join(frozen, name);
  mkdirSync(directory);
  const archive = path.join(frozen, `${name}.tar`);
  writeFileSync(
    archive,
    (
      await exec("git", ["archive", ref, "app"], {
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout,
  );
  await exec("tar", ["-xf", archive, "-C", directory]);
  symlinkSync(path.resolve("node_modules"), path.join(directory, "node_modules"), "dir");
}
export default defineConfig({
  plugins: [
    {
      name: "historical-sync-sources",
      enforce: "pre",
      async resolveId(source, importer) {
        if (process.env.LEGACY_SYNC_SERVER_REF) {
          const target = source.startsWith("~/")
            ? path.resolve("app", source.slice(2))
            : importer && source.startsWith(".")
              ? path.resolve(path.dirname(importer), source)
              : source;
          if (target === path.resolve("app/routes/api.sync.push"))
            return this.resolve(path.join(frozen, "server/app/routes/api.sync.push"), importer, {
              skipSelf: true,
            });
          if (importer?.startsWith(path.join(frozen, "server"))) {
            const relative = source.startsWith("~/")
              ? source.slice(2)
              : path.relative(path.join(frozen, "server/app"), target);
            if (
              [
                "lib/database/pool",
                "lib/database/auth-middleware",
                "lib/database/user/user",
              ].includes(relative)
            )
              return this.resolve(path.resolve("app", relative), importer, { skipSelf: true });
          }
        }
        const prefix = source.match(/^@legacy-(main|baseline)\/(.*)$/);
        if (prefix)
          return this.resolve(path.join(frozen, prefix[1], "app", prefix[2]), importer, {
            skipSelf: true,
          });
        if (source.startsWith("~/") && importer?.startsWith(frozen))
          return this.resolve(
            path.join(
              frozen,
              importer.slice(frozen.length + 1).split(path.sep)[0],
              "app",
              source.slice(2),
            ),
            importer,
            { skipSelf: true },
          );
      },
    },
  ],
  resolve: { tsconfigPaths: true },
  server: { fs: { allow: [process.cwd(), frozen] } },
  test: {
    environment: "node",
    setupFiles: ["fake-indexeddb/auto"],
    include: ["tests/legacy-*.test.ts"],
    testTimeout: 30_000,
  },
});
