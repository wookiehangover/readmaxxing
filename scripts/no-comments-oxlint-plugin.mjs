import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const baselinePath = resolve(repoRoot, "comment-baseline.json");
export const DUMP_ENV = "COMMENT_BASELINE_DUMP";
export const DUMP_PREFIX = "comment-baseline:";

const DIRECTIVE =
  /^(eslint|oxlint)(-disable|-enable|-env|\s)|^@ts-(expect-error|ignore|nocheck|check)\b|^@vitest-environment\b|^@vite-ignore\b|^[#@]__(PURE|NO_SIDE_EFFECTS)__|^webpack[A-Z]|^(istanbul|c8|v8)\s|^global\s|^(prettier|oxfmt)-ignore\b|^@jsx(ImportSource|Runtime|Frag)?\b/;

export function isAllowedComment(comment) {
  if (comment.type === "Shebang") return true;
  if (comment.type === "Line" && /^\/\s*<(reference|amd-module)\b/.test(comment.value)) return true;
  if (comment.type === "Block" && comment.value.startsWith("!")) return true;
  const text = comment.value.replace(/^\*+/, "").trim();
  return DIRECTIVE.test(text);
}

export function commentHash(comment) {
  const normalized = `${comment.type}:${comment.value.replace(/\s+/g, " ").trim()}`;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch {
    return {};
  }
}

const baseline = process.env[DUMP_ENV] ? {} : loadBaseline();

const noComments = {
  meta: {
    type: "suggestion",
    docs: { description: "Ban code comments, except tool directives and legacy baseline entries." },
  },
  create(context) {
    const file = relative(repoRoot, context.physicalFilename ?? context.filename)
      .split(sep)
      .join("/");
    const budget = { ...baseline[file] };
    const dump = Boolean(process.env[DUMP_ENV]);
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isAllowedComment(comment)) continue;
          const hash = commentHash(comment);
          if (dump) {
            context.report({ loc: comment.loc, message: `${DUMP_PREFIX}${hash}` });
            continue;
          }
          if (budget[hash] > 0) {
            budget[hash] -= 1;
            continue;
          }
          context.report({
            loc: comment.loc,
            message:
              "Comments are not allowed. Make the code say it, record decisions in docs/adr/, or file an issue for a workaround. See .claude/skills/delete-comment/SKILL.md.",
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "comments" },
  rules: { "no-comments": noComments },
};
