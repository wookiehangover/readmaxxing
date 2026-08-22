import {
  getCurrentReadingArtifacts,
  type ReadingArtifactRow,
} from "~/lib/database/reading-artifact/reading-artifact";
import { getShareLink, type ShareLinkRow } from "~/lib/database/share/share-link";

function isExpired(shareLink: ShareLinkRow): boolean {
  return shareLink.expiresAt != null && shareLink.expiresAt.getTime() <= Date.now();
}

function isExhausted(shareLink: ShareLinkRow): boolean {
  return shareLink.maxUses != null && shareLink.useCount >= shareLink.maxUses;
}

function serializeArtifact(artifact: ReadingArtifactRow) {
  return {
    content: artifact.content,
    revisionId: artifact.revisionId,
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

export async function loader({ params }: { params: { id: string } }) {
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "Sync not configured" }, { status: 503 });
  }

  const shareLink = await getShareLink(params.id);
  if (!shareLink) return Response.json({ error: "Share link not found" }, { status: 404 });
  if (isExpired(shareLink)) {
    return Response.json({ error: "Share link expired" }, { status: 410 });
  }
  if (isExhausted(shareLink)) {
    return Response.json({ error: "Share link exhausted" }, { status: 410 });
  }

  const rows = await getCurrentReadingArtifacts(shareLink.userId, shareLink.bookId);
  const outline = rows.find((artifact) => artifact.kind === "outline");
  return Response.json({
    bookId: shareLink.bookId,
    artifact: outline ? serializeArtifact(outline) : null,
  });
}
