import skill from "../../../.agents/skills/ebook-cleaner/SKILL.md?raw";
import inspect from "../../../.agents/skills/ebook-cleaner/scripts/inspect_epub.py?raw";
import validate from "../../../.agents/skills/ebook-cleaner/scripts/validate_epub.py?raw";
import renderCheck from "./render-check.mjs?raw";
import preserve from "./preserve-content.py?raw";

const engine = import.meta.glob("../../../packages/epub-successor/src/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const repairSkill = skill;
export function repairAssets() {
  return [
    { path: "SKILL.md", content: Buffer.from(skill) },
    { path: "inspect_epub.py", content: Buffer.from(inspect) },
    { path: "validate_epub.py", content: Buffer.from(validate) },
    { path: "render-check.mjs", content: Buffer.from(renderCheck) },
    { path: "preserve-content.py", content: Buffer.from(preserve) },
    {
      path: "check.html",
      content: Buffer.from('<div id="reader" style="width:900px;height:700px"></div>'),
    },
    ...Object.entries(engine)
      .filter(([path]) => !path.includes(".test."))
      .map(([path, source]) => ({
        path: `engine/${path.split("/src/")[1]}`,
        content: Buffer.from(source),
      })),
  ];
}
