import { defineConfig, type DummyRuleMap } from "oxlint";

// @ts-expect-error The package subpath intentionally has no TypeScript declarations.
import { react } from "@augmentcode/themis/eslint-plugins";

const themisRoot = "app/lib/themis";

interface ThemisFlatConfig {
  files: string[];
  ignores?: string[];
  rules: DummyRuleMap;
}

function scopeToThemisFiles(pattern: string) {
  return pattern.startsWith("src/")
    ? pattern.replace(/^src\//, `${themisRoot}/`)
    : `${themisRoot}/${pattern}`;
}

const themisOverrides = (react as ThemisFlatConfig[]).slice(1).map((config) => ({
  files: config.files.map(scopeToThemisFiles),
  ...(config.ignores ? { excludeFiles: config.ignores.map(scopeToThemisFiles) } : {}),
  rules: config.rules,
}));

export default defineConfig({
  jsPlugins: [
    { name: "themis", specifier: "./scripts/themis-oxlint-plugin.mjs" },
    { name: "comments", specifier: "./scripts/no-comments-oxlint-plugin.mjs" },
  ],
  rules: { "comments/no-comments": "error" },
  overrides: themisOverrides,
});
