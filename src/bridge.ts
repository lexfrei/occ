/**
 * Bridge: wires the OpenAI-compatible HTTP server to the MCP Channel
 * and the OpenClaw REST API for proactive messaging.
 *
 * Incoming:  HTTP request → extract context → push notification → wait for reply → HTTP response
 * Proactive: Claude Code → notify tool → OpenClaw REST API → messenger
 */

import {
  type RequestContext,
  buildNotificationMeta,
  formatNotificationContent,
} from "./context.js";
import { toErrorMessage } from "./errors.js";
import { validateAndReadFile } from "./file-validator.js";
import { HttpServer } from "./http-server.js";
import { McpChannel } from "./mcp-channel.js";
import { OpenClawApi } from "./openclaw-api.js";
import { type OccConfig } from "./types.js";

export class Bridge {
  private readonly httpServer: HttpServer;
  private readonly channel: McpChannel;
  private readonly replyTimeoutMs: number;

  constructor(config: OccConfig) {
    this.channel = new McpChannel();
    this.httpServer = new HttpServer(config);
    this.replyTimeoutMs = config.replyTimeoutMs;

    this.wireIncoming();

    if (OpenClawApi.isConfigured(config.openclawToken)) {
      this.wireProactive(config.openclawUrl, config.openclawToken);
    }
  }

  async start(): Promise<void> {
    await this.channel.connect();
    this.httpServer.start();
    console.error("[occ] bridge started");
  }

  async stop(): Promise<void> {
    await this.httpServer.stop();

    try {
      await this.channel.close();
    } catch (error: unknown) {
      console.error(`[occ] MCP close error: ${toErrorMessage(error)}`);
    }
  }

  private wireIncoming(): void {
    this.httpServer.onCompletion(async (context: RequestContext) => {
      const content = formatNotificationContent(context);
      const meta = buildNotificationMeta(context);

      console.error(`[occ] ← ${content.slice(0, 100)}`);

      const reply = await this.channel.pushAndWaitForReply(content, meta, this.replyTimeoutMs);

      console.error(`[occ] → ${reply.slice(0, 100)}`);
      return reply;
    });
  }

  private wireProactive(openclawUrl: string, openclawToken: string): void {
    const api = new OpenClawApi(openclawUrl, openclawToken);
    // Capture cwd at construction time — intentional: security boundary
    // should not shift if process.chdir() is called later
    const cwd = process.cwd();

    this.channel.onNotify(async (channel, to, text) => {
      console.error(`[occ] proactive → ${channel}:${to}: ${text.slice(0, 80)}`);
      const result = await api.sendMessage(channel, to, text);
      return result.messageId
        ? `Sent to ${channel}:${to} (id: ${result.messageId})`
        : `Sent to ${channel}:${to}`;
    });

    this.channel.onSendFile(async (channel, to, filePath) => {
      const file = await validateAndReadFile(filePath, cwd);
      console.error(`[occ] send_file → ${channel}:${to}: ${file.fileName}`);

      const result = await api.sendFile(channel, to, {
        fileName: file.fileName,
        contentType: Bridge.extensionToMime(file.extension),
        buffer: Buffer.from(file.content).toString("base64"),
      });
      return result.messageId
        ? `File sent to ${channel}:${to} (id: ${result.messageId})`
        : `File sent to ${channel}:${to}`;
    });

    console.error("[occ] proactive messaging enabled");
  }

  private static readonly mimeMap: Record<string, string> = {
    ts: "text/typescript",
    js: "text/javascript",
    py: "text/x-python",
    json: "application/json",
    md: "text/markdown",
    yaml: "text/yaml",
    yml: "text/yaml",
  };

  private static extensionToMime(extension: string): string {
    return Bridge.mimeMap[extension] ?? "text/plain";
  }
}
