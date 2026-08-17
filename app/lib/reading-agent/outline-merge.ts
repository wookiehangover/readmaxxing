const UNTITLED_CHAPTER = "Untitled";
const CHAPTER_HEADING_PATTERN = /^##[ \t]+(.+?)[ \t]*$/gm;
const BULLET_PATTERN = /^-[ \t]+(.+?)[ \t]*$/gm;

interface ChapterSection {
  readonly contentStart: number;
  readonly bodyEnd: number;
  readonly end: number;
}

export interface OutlineIncrementMetadata {
  readonly locator: string;
  readonly displayPage?: number | null;
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

export function getOutlineChapterBullets(
  markdown: string,
  chapterLabel: string | null | undefined,
): string[] {
  const section = findChapter(markdown, normalizeChapterLabel(chapterLabel));
  return [...existingBullets(markdown, section)];
}

function normalizedBullets(bullets: readonly string[]): string[] {
  return bullets.map(normalizeBullet).filter(Boolean);
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function incrementMarkdown(
  bullets: readonly string[],
  metadata: OutlineIncrementMetadata,
  eol: string,
): string {
  const pageAttribute = metadata.displayPage == null ? "" : ` data-page="${metadata.displayPage}"`;
  const opening = `<div data-outline-increment="" data-locator="${escapeAttribute(metadata.locator)}"${pageAttribute}>`;
  const bulletMarkdown = bullets.map((bullet) => `- ${bullet}`).join(eol);
  return `${opening}${eol}${eol}${bulletMarkdown}${eol}${eol}</div>`;
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
  metadata: OutlineIncrementMetadata,
): string {
  const label = normalizeChapterLabel(chapterLabel);
  const section = findChapter(currentMarkdown, label);
  const additions = normalizedBullets(bullets);

  if (additions.length === 0) return currentMarkdown;

  const eol = currentMarkdown.includes("\r\n") ? "\r\n" : "\n";
  const increment = incrementMarkdown(additions, metadata, eol);
  if (!section) {
    return appendSection(currentMarkdown, `## ${label}${eol}${eol}${increment}`, eol);
  }

  return `${currentMarkdown.slice(0, section.bodyEnd)}${eol}${eol}${increment}${currentMarkdown.slice(section.bodyEnd)}`;
}
