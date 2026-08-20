import { react } from "@augmentcode/themis/eslint-plugins";
import babelParser from "@babel/eslint-parser";

const themisFiles = ["app/lib/themis/**/*.{ts,tsx}"];

function scopeToThemisFiles(pattern) {
  return pattern.replace(/^src\//, "app/lib/themis/");
}

export default [
  {
    name: "readmaxxing/themis-typescript",
    files: themisFiles,
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { parserOpts: { plugins: ["typescript", "jsx"] } },
      },
    },
  },
  ...react.map((config) => ({
    ...config,
    ...(config.files ? { files: config.files.map(scopeToThemisFiles) } : {}),
    ...(config.ignores ? { ignores: config.ignores.map(scopeToThemisFiles) } : {}),
  })),
];
