/**
 * OpenAI-compatible HTTP server.
 *
 * Exposes POST /v1/chat/completions that OpenClaw calls as a model provider.
 * Extracts context and routes to the completion handler (bridge → Claude Code).
 */

import { type RequestContext, extractContext } from "./context.js";
import { toErrorMessage } from "./errors.js";
import { type ChatCompletionRequest, type OccConfig } from "./types.js";
import { VERSION } from "./version.js";

/** Claude Code context window (as of March 2026). */
const CLAUDE_CONTEXT_WINDOW = 200_000;
/** Claude Code max output tokens (as of March 2026). */
const CLAUDE_MAX_OUTPUT_TOKENS = 16_384;

type CompletionHandler = (context: RequestContext) => Promise<string>;

export class HttpServer {
  private readonly port: number;
  private readonly apiToken: string;
  private server: ReturnType<typeof Bun.serve> | undefined;
  private completionHandler: CompletionHandler | undefined;

  constructor(config: OccConfig) {
    this.port = config.port;
    this.apiToken = config.apiToken;
  }

  onCompletion(handler: CompletionHandler): void {
    this.completionHandler = handler;
  }

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      fetch: async (request) => this.handleRequest(request),
    });

    console.error(`[occ] HTTP server listening on http://127.0.0.1:${String(this.port)}`);
  }

  async stop(): Promise<void> {
    await this.server?.stop();
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/v1/models" && request.method === "GET") {
      return HttpServer.handleListModels();
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return this.handleChatCompletion(request);
    }

    if ((url.pathname === "/health" || url.pathname === "/healthz") && request.method === "GET") {
      return Response.json({ ok: true, version: VERSION });
    }

    return new Response("Not Found", { status: 404 });
  }

  private static handleListModels(): Response {
    return Response.json({
      object: "list",
      data: [
        {
          id: "claude-code",
          object: "model",
          created: 0,
          owned_by: "occ",
          context_window: CLAUDE_CONTEXT_WINDOW,
          max_output_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
        },
      ],
    });
  }

  private async handleChatCompletion(request: Request): Promise<Response> {
    const authHeader = request.headers.get("authorization");
    const expectedAuth = `Bearer ${this.apiToken}`;

    if (authHeader !== expectedAuth) {
      return Response.json(
        { error: { message: "Invalid API key", type: "authentication_error" } },
        { status: 401 },
      );
    }

    if (!this.completionHandler) {
      return Response.json(
        { error: { message: "No completion handler configured", type: "server_error" } },
        { status: 500 },
      );
    }

    const parseResult = await HttpServer.parseRequestBody(request);

    if (!parseResult.ok) {
      return Response.json(
        { error: { message: "Invalid JSON in request body", type: "invalid_request_error" } },
        { status: 400 },
      );
    }

    const { body } = parseResult;

    const context = extractContext(body, request.headers);

    if (context.userMessage.length === 0) {
      return Response.json(
        { error: { message: "No user message found", type: "invalid_request_error" } },
        { status: 400 },
      );
    }

    try {
      const responseText = await this.completionHandler(context);
      const completionId = `chatcmpl-occ-${crypto.randomUUID().slice(0, 8)}`;
      const timestamp = Math.floor(Date.now() / 1000);

      if (body.stream) {
        return HttpServer.streamResponse(completionId, timestamp, responseText);
      }

      return Response.json({
        id: completionId,
        object: "chat.completion",
        created: timestamp,
        model: "claude-code",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: responseText },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    } catch (error: unknown) {
      console.error(`[occ] completion error: ${toErrorMessage(error)}`);
      return Response.json(
        { error: { message: toErrorMessage(error), type: "server_error" } },
        { status: 500 },
      );
    }
  }

  private static async parseRequestBody(
    request: Request,
  ): Promise<{ ok: true; body: ChatCompletionRequest } | { ok: false }> {
    try {
      const raw: unknown = await request.json();

      if (
        typeof raw !== "object" ||
        raw === null ||
        !("messages" in raw) ||
        !Array.isArray((raw as Record<string, unknown>)["messages"]) ||
        !((raw as Record<string, unknown[]>)["messages"] ?? []).every(
          (message) => typeof message === "object" && message !== null && "role" in message,
        )
      ) {
        return { ok: false };
      }

      return { ok: true, body: raw as ChatCompletionRequest };
    } catch {
      return { ok: false };
    }
  }

  /** Split text into chunks of ~50 chars at word boundaries. */
  private static splitIntoChunks(text: string, targetSize: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= targetSize) {
        chunks.push(remaining);
        break;
      }

      const spaceAt = remaining.lastIndexOf(" ", targetSize);

      if (spaceAt > 0) {
        // Include the space at the end of this chunk to preserve word boundaries
        chunks.push(remaining.slice(0, spaceAt + 1));
        remaining = remaining.slice(spaceAt + 1);
      } else {
        chunks.push(remaining.slice(0, targetSize));
        remaining = remaining.slice(targetSize);
      }
    }

    return chunks;
  }

  private static streamResponse(completionId: string, timestamp: number, text: string): Response {
    const encoder = new TextEncoder();
    const chunks = HttpServer.splitIntoChunks(text, 50);

    const stream = new ReadableStream({
      start(controller): void {
        // Role chunk (first)
        const roleChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: timestamp,
          model: "claude-code",
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

        // Content chunks
        for (const piece of chunks) {
          const contentChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created: timestamp,
            model: "claude-code",
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`));
        }

        // Done chunk
        const done = {
          id: completionId,
          object: "chat.completion.chunk",
          created: timestamp,
          model: "claude-code",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(done)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }
}
