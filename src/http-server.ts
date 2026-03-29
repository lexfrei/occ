/**
 * OpenAI-compatible HTTP server.
 *
 * Exposes POST /v1/chat/completions that OpenClaw calls as a model provider.
 * Routes messages to Claude Code via the MCP channel and returns
 * responses as SSE streaming or JSON.
 */

import { toErrorMessage } from "./errors.js";
import { type ChatCompletionRequest, type OccConfig } from "./types.js";
import { VERSION } from "./version.js";

type CompletionHandler = (
  userMessage: string,
  allMessages: ChatCompletionRequest["messages"],
) => Promise<string>;

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

    if (url.pathname === "/health" || url.pathname === "/healthz") {
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

    const body = (await request.json()) as ChatCompletionRequest;
    const userMessages = body.messages.filter((message) => message.role === "user");
    const lastUserMessage = userMessages.at(-1)?.content ?? "";

    if (lastUserMessage.length === 0) {
      return Response.json(
        { error: { message: "No user message found", type: "invalid_request_error" } },
        { status: 400 },
      );
    }

    try {
      const responseText = await this.completionHandler(lastUserMessage, body.messages);
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

  private static streamResponse(completionId: string, timestamp: number, text: string): Response {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller): void {
        const chunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created: timestamp,
          model: "claude-code",
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        };

        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

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
