import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { Client } from "./client.js";
import { saveConfig, validateToken } from "./config.js";
import { startLoginCallback, type LoginCallback } from "./login-callback.js";

async function connect(url: string, token: string, signal?: AbortSignal) {
  const config = { url, token: validateToken(token) };
  const { user } = await new Client(config).json<{ user: { displayName: string } }>(
    "/api/auth/session",
    { signal },
  );
  signal?.throwIfAborted();
  await saveConfig(config);
  const name = stripVTControlCharacters(user.displayName).replace(/[\p{Cc}\p{Cf}]/gu, " ");
  process.stderr.write(`Signed in as ${name} on ${url}.\n`);
}

function openBrowser(target: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const child = spawn(command, [target], { stdio: "ignore", detached: true, shell: false });
  child.on("error", () =>
    process.stderr.write("Open the link above in your browser to continue.\n"),
  );
  child.on("exit", (code) => {
    if (code) process.stderr.write("Open the link above in your browser to continue.\n");
  });
  child.unref();
}

export async function login(url: string, tokenStdin: boolean, noBrowser: boolean) {
  if (tokenStdin) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 1024) throw new Error("Invalid token input.");
    }
    await connect(url, input.trim());
    return;
  }
  if (!process.stdin.isTTY) throw new Error("Use --token-stdin for non-interactive login.");

  const cancelled = new AbortController();
  let cancel!: () => void;
  const cancellation = new Promise<"cancelled">((resolve) => {
    cancel = () => {
      cancelled.abort();
      resolve("cancelled");
    };
  });
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  // Hidden input remains available if the browser cannot reach this terminal.
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  reader.on("SIGINT", cancel);
  reader.on("close", cancel);
  let callback: LoginCallback | undefined;
  try {
    try {
      callback = await startLoginCallback(url, (token, signal) =>
        connect(url, token, AbortSignal.any([signal, cancelled.signal])),
      );
    } catch {
      process.stderr.write("Automatic sign-in unavailable. Use the token shown in your browser.\n");
    }
    if (cancelled.signal.aborted) throw new Error("Login cancelled.");
    const target = new URL("/cli", url);
    if (callback) {
      target.searchParams.set("callback", callback.url);
      target.searchParams.set("state", callback.state);
    }
    process.stderr.write(`Open ${target.href}\n`);
    if (!noBrowser) openBrowser(target.href);

    process.stderr.write(
      callback
        ? "Waiting for browser sign-in. Press Enter to paste a token instead.\n"
        : "CLI token (hidden): ",
    );
    const input = () =>
      reader.question("", { signal: cancelled.signal }).then((token) => ({ token: token.trim() }));
    const firstInput = input();
    const first = await Promise.race([
      firstInput,
      cancellation,
      ...(callback ? [callback.result] : []),
    ]);
    if (first === "cancelled") throw new Error("Login cancelled.");
    if (first === "connected") return;

    await callback?.close();
    if (callback && (await callback.result) === "connected") return;
    let token: string;
    if (first === "closed") {
      process.stderr.write(
        "Automatic sign-in timed out. Paste the token from your browser (hidden): ",
      );
      const fallback = await Promise.race([firstInput, cancellation]);
      if (fallback === "cancelled") throw new Error("Login cancelled.");
      token = fallback.token;
    } else {
      token = first.token;
    }
    if (!token) {
      process.stderr.write("CLI token (hidden): ");
      const fallback = await Promise.race([input(), cancellation]);
      if (fallback === "cancelled") throw new Error("Login cancelled.");
      token = fallback.token;
    }
    await connect(url, token, cancelled.signal);
  } finally {
    cancelled.abort();
    reader.close();
    await callback?.close();
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
