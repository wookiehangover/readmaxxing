import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { validateToken } from "./config.js";

export interface LoginCallback {
  url: string;
  state: string;
  result: Promise<"connected" | "closed">;
  close(): Promise<void>;
}

/** A single login attempt, reachable only through the loopback interface. */
export async function startLoginCallback(
  origin: string,
  connect: (token: string, signal: AbortSignal) => Promise<void>,
  timeoutMs = 120_000,
): Promise<LoginCallback> {
  const state = randomBytes(32).toString("base64url");
  const controller = new AbortController();
  let settle!: (result: "connected" | "closed") => void;
  const result = new Promise<"connected" | "closed">((resolve) => {
    settle = resolve;
  });
  let pending: Promise<void> | undefined;
  let connected = false;
  let closed = false;
  let host = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.headers.host !== host || request.headers.origin !== origin) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (request.url !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "POST");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    if (closed || connected || pending) {
      response.writeHead(409).end();
      return;
    }
    if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
      response.writeHead(415).end();
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 2048) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        typeof payload?.state !== "string" ||
        payload.state.length !== state.length ||
        !timingSafeEqual(Buffer.from(payload.state), Buffer.from(state))
      ) {
        response.writeHead(403).end();
        return;
      }
      const token = validateToken(payload.token);
      // Recheck after reading the body: two callbacks can arrive together.
      if (closed || connected || pending) {
        response.writeHead(409).end();
        return;
      }
      pending = connect(token, controller.signal);
      try {
        await pending;
        connected = true;
        response.setHeader("Content-Type", "application/json");
        // A browser timeout must not strand a CLI whose session was already saved.
        if (response.destroyed) settle("connected");
        else {
          response.once("close", () => settle("connected"));
          response.end(JSON.stringify({ ok: true }), () => settle("connected"));
        }
        clearTimeout(timer);
        server.close();
      } catch {
        response.writeHead(400).end();
      } finally {
        pending = undefined;
      }
    } catch {
      if (!response.headersSent) response.writeHead(400).end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start login callback.");
  host = `127.0.0.1:${address.port}`;

  async function close() {
    closed = true;
    clearTimeout(timer);
    controller.abort();
    server.close();
    server.closeAllConnections();
    await pending?.catch(() => {});
    settle(connected ? "connected" : "closed");
  }
  server.on("error", () => {
    void close();
  });
  timer = setTimeout(() => {
    void close();
  }, timeoutMs);
  timer.unref();
  return { url: `http://${host}/callback`, state, result, close };
}
