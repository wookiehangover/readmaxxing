import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type LocalFileKind = "file" | "cover";

interface LocalFileLocation {
  userId: string;
  bookId: string;
  type: LocalFileKind;
}

const SAFE_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function localFilePaths({ userId, bookId, type }: LocalFileLocation) {
  if (!SAFE_IDENTIFIER.test(userId) || !SAFE_IDENTIFIER.test(bookId)) {
    throw new Error("Invalid local file storage identifier");
  }

  if (type !== "file" && type !== "cover") {
    throw new Error("Invalid local file storage type");
  }

  const directory = join(process.cwd(), "data", "blob", userId, bookId);
  return {
    directory,
    dataPath: join(directory, type),
    metadataPath: join(directory, `${type}.json`),
  };
}

export function useLocalFileStorage(): boolean {
  const backend = process.env.BLOB_STORAGE_BACKEND;

  if (backend === "local") return true;
  if (backend === "vercel") return false;
  if (backend) throw new Error(`Invalid BLOB_STORAGE_BACKEND: ${backend}`);

  return process.env.NODE_ENV === "development";
}

export async function writeLocalFile(
  input: LocalFileLocation & { data: Uint8Array; contentType: string },
): Promise<{ url: string }> {
  const { directory, dataPath, metadataPath } = localFilePaths(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(dataPath, input.data, { mode: 0o600 }),
    writeFile(metadataPath, JSON.stringify({ contentType: input.contentType }), { mode: 0o600 }),
  ]);

  return {
    url: `/api/sync/files/download?bookId=${encodeURIComponent(input.bookId)}&type=${input.type}`,
  };
}

export async function readLocalFile(
  input: LocalFileLocation,
): Promise<{ data: Uint8Array; contentType: string } | null> {
  const { dataPath, metadataPath } = localFilePaths(input);

  try {
    const [data, metadata] = await Promise.all([
      readFile(dataPath),
      readFile(metadataPath, "utf8"),
    ]);
    const { contentType } = JSON.parse(metadata) as { contentType: string };
    return { data: Uint8Array.from(data), contentType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
