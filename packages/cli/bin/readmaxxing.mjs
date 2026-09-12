#!/usr/bin/env node
import { clean, tone } from "../dist/terminal.js";
import { run } from "../dist/main.js";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

run(process.argv.slice(2)).catch((error) => {
  console.error(`${tone("error", 31, process.stderr)} ${clean(error.message)}`);
  process.exitCode = 1;
});
