#!/usr/bin/env node
import { run } from "../dist/main.js";

process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

run(process.argv.slice(2)).catch((error) => {
  console.error(`readmaxxing: ${error.message}`);
  process.exitCode = 1;
});
