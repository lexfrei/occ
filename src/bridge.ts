/**
 * Bridge: wires the OpenAI-compatible HTTP server to the MCP Channel.
 *
 * HTTP request → push notification into Claude Code → wait for reply tool → HTTP response.
 */

import { toErrorMessage } from "./errors.js";
import { HttpServer } from "./http-server.js";
import { McpChannel } from "./mcp-channel.js";
import { type OccConfig } from "./types.js";

const REPLY_TIMEOUT_MS = 120_000;

export class Bridge {
  private readonly httpServer: HttpServer;
  private readonly channel: McpChannel;

  constructor(config: OccConfig) {
    this.channel = new McpChannel();
    this.httpServer = new HttpServer(config);

    this.httpServer.onCompletion(async (userMessage) => {
      console.error(`[occ] ← ${userMessage.slice(0, 100)}`);

      const reply = await this.channel.pushAndWaitForReply(userMessage, REPLY_TIMEOUT_MS);

      console.error(`[occ] → ${reply.slice(0, 100)}`);
      return reply;
    });
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
}
