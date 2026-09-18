import { z } from "zod";

// Keep raw files below Vercel Functions' 4.5 MB payload ceiling.
export const MAX_REPAIR_BYTES = 4 * 1024 * 1024;
export const REPAIR_TIMEOUT_MS = 240_000;
export const repairJobSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  sourceHash: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  diagnostics: z.array(z.string()),
  error: z.string().nullable(),
});
export type RepairJob = z.infer<typeof repairJobSchema>;
