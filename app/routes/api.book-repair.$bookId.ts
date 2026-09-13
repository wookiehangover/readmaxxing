import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { getSessionFromRequest } from "~/lib/database/auth-middleware";
import { createRepairJob, getRepairJob, readRepairOutput } from "~/lib/repair/repair-jobs.server";
import { runRepairJob } from "~/lib/repair/repair-runner.server";
import { MAX_REPAIR_BYTES } from "~/lib/repair/repair-types";

export const maxDuration = 300;
type Args = { request: Request; params: { bookId?: string } };
const response = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

async function authorize({ request, params }: Args) {
  if (!process.env.DATABASE_URL)
    throw response({ error: "Sign in and configure sync to use book repair." }, 503);
  const session = await getSessionFromRequest(request);
  if (!session) throw response({ error: "Sign in to repair this book." }, 401);
  if (!params.bookId || params.bookId.length > 200) throw response({ error: "Invalid book." }, 400);
  return { userId: session.userId, bookId: params.bookId };
}

export async function loader(args: Args) {
  const { userId, bookId } = await authorize(args);
  const url = new URL(args.request.url);
  const id = url.searchParams.get("jobId");
  if (id && !z.uuid().safeParse(id).success) return response({ error: "Invalid repair ID." }, 400);
  if (url.searchParams.get("download") === "1") {
    const data = id ? await readRepairOutput(userId, bookId, id) : null;
    if (!data) return response({ error: "Repaired file is not available." }, 404);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/epub+zip",
        "Content-Disposition": 'attachment; filename="repaired.epub"',
        "Cache-Control": "private, no-store",
      },
    });
  }
  return response({ job: await getRepairJob(userId, bookId, id ?? undefined) });
}

export async function action(args: Args) {
  if (args.request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  const { userId, bookId } = await authorize(args);
  if (args.request.headers.get("Origin") !== new URL(args.request.url).origin)
    return response({ error: "Invalid request origin." }, 403);
  if (
    !process.env.REPAIR_SANDBOX_SNAPSHOT_ID ||
    (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN)
  )
    return response(
      { error: "Book repair is not configured. Set up the repair sandbox and AI Gateway first." },
      503,
    );
  if (args.request.headers.get("Content-Type") !== "application/epub+zip")
    return response({ error: "Book repair currently supports EPUB files only." }, 415);
  const reader = args.request.body?.getReader();
  if (!reader) return response({ error: "Missing EPUB file." }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_REPAIR_BYTES) {
        await reader.cancel();
        return response({ error: "Book repair supports files up to 4 MiB." }, 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const source = Buffer.concat(chunks);
  if (source.length < 4 || source.readUInt32LE(0) !== 0x04034b50)
    return response({ error: "The file is not an EPUB ZIP archive." }, 400);
  const hash = createHash("sha256").update(source).digest("hex");
  const current = await getRepairJob(userId, bookId);
  if (current?.status === "running") return response({ job: current });
  const job = await createRepairJob(userId, bookId, hash);
  if (!job) return response({ error: "A repair is already running. Wait for it to finish." }, 409);
  const work = runRepairJob(job.id, source).catch((error) =>
    console.error("Repair job failed", error),
  );
  waitUntil(work);
  return response({ job }, 202);
}
