import { Agent } from "agents";
import { UI_MESSAGE_STREAM_HEADERS, generateId } from "ai";
import { createChatStreamResponse, type ChatAgentStartBody } from "~/lib/chat/chat-stream.server";
import { runWithEnv, type Env } from "~/lib/env.server";

type StreamStatus = "active" | "complete" | "error";

interface StreamRow {
  stream_id: string;
  status: StreamStatus;
}

interface StreamChunkRow {
  sequence: number;
  body: string;
}

interface StreamSubscriber {
  streamId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
}

const encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function isStartBody(value: unknown): value is ChatAgentStartBody {
  if (!isRecord(value)) return false;
  const message = value.message;
  // A conversation is anchored by either the legacy single `bookId` or a
  // non-empty `bookIds` array (multi-book chat); `bookIds[0]` is the primary.
  const hasBookId = typeof value.bookId === "string" && value.bookId.length > 0;
  const hasBookIds =
    Array.isArray(value.bookIds) &&
    value.bookIds.length > 0 &&
    value.bookIds.every((id) => typeof id === "string");
  return (
    typeof value.userId === "string" &&
    typeof value.sessionId === "string" &&
    (hasBookId || hasBookIds) &&
    isRecord(message) &&
    typeof message.id === "string" &&
    message.role === "user" &&
    (value.currentChapterIndex == null || typeof value.currentChapterIndex === "number") &&
    (value.visibleText == null || typeof value.visibleText === "string") &&
    (value.bookContexts == null || isRecord(value.bookContexts))
  );
}

export class ChatAgent extends Agent<Env> {
  private readonly runtimeEnv: Env;
  private readonly durableState: DurableObjectState;
  private readonly subscribers = new Set<StreamSubscriber>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.runtimeEnv = env;
    this.durableState = ctx;
  }

  override onRequest(request: Request): Promise<Response> {
    return runWithEnv(this.runtimeEnv, this.durableState as unknown as ExecutionContext, () =>
      this.handleRequest(request),
    );
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/chat")) {
      return this.startChat(request);
    }
    if (request.method === "GET" && url.pathname.endsWith("/resume")) {
      return this.resumeChat(url);
    }
    return new Response("Not found", { status: 404 });
  }

  private async startChat(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!isStartBody(body)) {
      return Response.json({ error: "Invalid chat agent request" }, { status: 400 });
    }

    const streamId = generateId();
    this.prepareStream(streamId);

    return createChatStreamResponse(body, {
      streamId,
      consumeSseStream: ({ stream }) => {
        const consumePromise = this.consumeAndStoreStream(streamId, stream);
        this.waitUntil(consumePromise);
      },
    });
  }

  private resumeChat(url: URL): Response {
    const streamId = url.searchParams.get("streamId");
    if (!streamId) {
      return Response.json({ error: "streamId is required" }, { status: 400 });
    }

    this.ensureStreamTables();
    const row = this.getStream(streamId);
    if (!row) {
      return new Response(null, { status: 204 });
    }

    let subscriber: StreamSubscriber | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const chunk of this.getChunks(streamId)) {
          controller.enqueue(encoder.encode(chunk.body));
        }

        if (row.status !== "active") {
          controller.close();
          return;
        }

        subscriber = { streamId, controller };
        this.subscribers.add(subscriber);
      },
      cancel: () => {
        if (subscriber) this.subscribers.delete(subscriber);
      },
    });

    return new Response(body, { headers: UI_MESSAGE_STREAM_HEADERS });
  }

  private async consumeAndStoreStream(
    streamId: string,
    stream: ReadableStream<string>,
  ): Promise<void> {
    const reader = stream.getReader();
    let sequence = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sequence += 1;
        this.storeChunk(streamId, sequence, value);
        this.broadcastChunk(streamId, value);
      }
      this.markStream(streamId, "complete");
      this.closeSubscribers(streamId);
    } catch (error) {
      console.error("ChatAgent stream consumption failed:", error);
      this.markStream(streamId, "error");
      this.closeSubscribers(streamId);
    }
  }

  private prepareStream(streamId: string) {
    const now = Date.now();
    this.ensureStreamTables();
    this.closeAllSubscribers();
    this.executeSql(["DELETE FROM chat_agent_stream_chunks"]);
    this.executeSql(["DELETE FROM chat_agent_streams"]);
    this.executeSql(
      [
        "INSERT INTO chat_agent_streams (stream_id, status, created_at, updated_at) VALUES (",
        ", ",
        ", ",
        ", ",
        ")",
      ],
      streamId,
      "active",
      now,
      now,
    );
  }

  private ensureStreamTables() {
    this.executeSql([
      `CREATE TABLE IF NOT EXISTS chat_agent_streams (
        stream_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ]);
    this.executeSql([
      `CREATE TABLE IF NOT EXISTS chat_agent_stream_chunks (
        stream_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (stream_id, sequence)
      )`,
    ]);
  }

  private getStream(streamId: string): StreamRow | undefined {
    return this.sql<StreamRow>`
      SELECT stream_id, status
      FROM chat_agent_streams
      WHERE stream_id = ${streamId}
      LIMIT 1
    `[0];
  }

  private getChunks(streamId: string): StreamChunkRow[] {
    return this.sql<StreamChunkRow>`
      SELECT sequence, body
      FROM chat_agent_stream_chunks
      WHERE stream_id = ${streamId}
      ORDER BY sequence ASC
    `;
  }

  private storeChunk(streamId: string, sequence: number, body: string) {
    this.executeSql(
      [
        "INSERT INTO chat_agent_stream_chunks (stream_id, sequence, body) VALUES (",
        ", ",
        ", ",
        ") ON CONFLICT (stream_id, sequence) DO UPDATE SET body = excluded.body",
      ],
      streamId,
      sequence,
      body,
    );
  }

  private markStream(streamId: string, status: StreamStatus) {
    this.executeSql(
      ["UPDATE chat_agent_streams SET status = ", ", updated_at = ", " WHERE stream_id = ", ""],
      status,
      Date.now(),
      streamId,
    );
  }

  private executeSql(strings: readonly string[], ...values: (string | number | boolean | null)[]) {
    const template = Object.assign([...strings], {
      raw: [...strings],
    }) as unknown as TemplateStringsArray;
    this.sql(template, ...values);
  }

  private broadcastChunk(streamId: string, chunk: string) {
    for (const subscriber of Array.from(this.subscribers)) {
      if (subscriber.streamId !== streamId) continue;
      try {
        subscriber.controller.enqueue(encoder.encode(chunk));
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private closeSubscribers(streamId: string) {
    for (const subscriber of Array.from(this.subscribers)) {
      if (subscriber.streamId !== streamId) continue;
      try {
        subscriber.controller.close();
      } catch {
      } finally {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private closeAllSubscribers() {
    for (const subscriber of Array.from(this.subscribers)) {
      try {
        subscriber.controller.close();
      } catch {
      } finally {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private waitUntil(promise: Promise<unknown>) {
    const stateWithWaitUntil = this.durableState as DurableObjectState & {
      waitUntil?: (promise: Promise<unknown>) => void;
    };
    stateWithWaitUntil.waitUntil?.(promise);
  }
}
