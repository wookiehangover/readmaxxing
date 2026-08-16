const UNTITLED_CHAPTER = "Untitled";
const CHAPTER_HEADING_PATTERN = /^##[ \t]+(.+?)[ \t]*$/gm;
const BULLET_PATTERN = /^-[ \t]+(.+?)[ \t]*$/gm;

interface ChapterSection {
  readonly contentStart: number;
  readonly bodyEnd: number;
  readonly end: number;
}

function normalizeChapterLabel(chapterLabel: string | null | undefined): string {
  return chapterLabel?.trim().replace(/\s+/g, " ") || UNTITLED_CHAPTER;
}

function normalizeBullet(bullet: string): string {
  return bullet
    .trim()
    .replace(/^-[ \t]+/, "")
    .replace(/\s+/g, " ");
}

function findChapter(markdown: string, chapterLabel: string): ChapterSection | null {
  const headings = [...markdown.matchAll(CHAPTER_HEADING_PATTERN)];
  const headingIndex = headings.findIndex((match) => match[1]?.trim() === chapterLabel);
  if (headingIndex < 0) return null;

  const heading = headings[headingIndex];
  const end = headings[headingIndex + 1]?.index ?? markdown.length;
  let bodyEnd = end;
  while (bodyEnd > (heading.index ?? 0) + heading[0].length && /\s/.test(markdown[bodyEnd - 1]!)) {
    bodyEnd -= 1;
  }

  return { contentStart: (heading.index ?? 0) + heading[0].length, bodyEnd, end };
}

function existingBullets(markdown: string, section: ChapterSection | null): Set<string> {
  if (!section) return new Set();
  return new Set(
    [...markdown.slice(section.contentStart, section.end).matchAll(BULLET_PATTERN)]
      .map((match) => normalizeBullet(match[1] ?? ""))
      .filter(Boolean),
  );
}

function newBullets(bullets: readonly string[], seen: Set<string>): string[] {
  const additions: string[] = [];
  for (const candidate of bullets) {
    const bullet = normalizeBullet(candidate);
    if (!bullet || seen.has(bullet)) continue;
    seen.add(bullet);
    additions.push(bullet);
  }
  return additions;
}

function appendSection(markdown: string, sectionMarkdown: string, eol: string): string {
  if (!markdown.trim()) return sectionMarkdown;
  if (markdown.endsWith(`${eol}${eol}`)) return `${markdown}${sectionMarkdown}`;
  if (markdown.endsWith(eol)) return `${markdown}${eol}${sectionMarkdown}`;
  return `${markdown}${eol}${eol}${sectionMarkdown}`;
}

export function mergeOutlineMarkdown(
  currentMarkdown: string,
  chapterLabel: string | null | undefined,
  bullets: readonly string[],
): string {
  const label = normalizeChapterLabel(chapterLabel);
  const section = findChapter(currentMarkdown, label);
  const additions = newBullets(bullets, existingBullets(currentMarkdown, section));

  if (additions.length === 0) return currentMarkdown;

  const eol = currentMarkdown.includes("\r\n") ? "\r\n" : "\n";
  const bulletMarkdown = additions.map((bullet) => `- ${bullet}`).join(eol);
  if (!section) {
    return appendSection(currentMarkdown, `## ${label}${eol}${bulletMarkdown}`, eol);
  }

  return `${currentMarkdown.slice(0, section.bodyEnd)}${eol}${bulletMarkdown}${currentMarkdown.slice(section.bodyEnd)}`;
}
