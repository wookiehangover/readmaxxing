import { Sandbox } from "@vercel/sandbox";

// Run with Vercel credentials: node --env-file=.env scripts/create-repair-snapshot.mjs
// The snapshot contains tools only. Book files and the engine are supplied per job.
const sandbox = await Sandbox.create({
  image: "vercel/sandbox/universal",
  timeout: 600_000,
  persistent: false,
});
try {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "npm install --save-exact @playwright/test@1.62.1 vite@8.2.2 fflate@0.8.3 && npx playwright install --with-deps chromium && python3 --version",
    ],
    cwd: "/vercel/sandbox",
  });
  if (result.exitCode !== 0) throw new Error(await result.stderr());
  const snapshot = await sandbox.snapshot();
  console.log(`REPAIR_SANDBOX_SNAPSHOT_ID=${snapshot.snapshotId}`);
} finally {
  await sandbox.delete({ deleteOrphanSnapshots: false });
}
