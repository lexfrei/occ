/**
 * Claude Code Channel (MCP stdio).
 *
 * Pushes inbound messages as channel notifications,
 * exposes a reply tool that resolves pending HTTP responses.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { VERSION } from "./version.js";

const CHANNEL_INSTRUCTIONS = [
  "You are connected to OpenClaw via the OCC bridge.",
  'Messages from users arrive as <channel source="occ"> tags.',
  "To respond, call the `reply` tool with the message text.",
  "Your reply will be delivered back to the user's messenger.",
].join("\n");

type ReplyCallback = (text: string) => void;

export class McpChannel {
  private readonly mcpServer: McpServer;
  private pendingReply: ReplyCallback | undefined;

  constructor() {
    this.mcpServer = new McpServer(
      { name: "occ", version: VERSION },
      {
        capabilities: {
          experimental: {
            "claude/channel": {},
          },
        },
        instructions: CHANNEL_INSTRUCTIONS,
      },
    );

    this.registerReplyTool();
  }

  /** Push a user message into the Claude Code session. */
  async pushMessage(content: string): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel",
      params: { content },
    });
  }

  /**
   * Push a message and wait for Claude Code to call the reply tool.
   * The returned promise resolves with the reply text.
   */
  async pushAndWaitForReply(content: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReply = undefined;
        reject(new Error("Claude Code did not reply in time"));
      }, timeoutMs);

      this.pendingReply = (text: string): void => {
        clearTimeout(timer);
        this.pendingReply = undefined;
        resolve(text);
      };

      this.pushMessage(content).catch((error: unknown) => {
        clearTimeout(timer);
        this.pendingReply = undefined;
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("[occ] MCP channel connected via stdio");
  }

  async close(): Promise<void> {
    await this.mcpServer.close();
  }

  private registerReplyTool(): void {
    this.mcpServer.registerTool(
      "reply",
      {
        description: "Send a reply back to the user through OpenClaw.",
        inputSchema: {
          text: z.string().describe("The response text to send to the user"),
        },
      },
      ({ text }) => {
        if (this.pendingReply) {
          this.pendingReply(text);
          return { content: [{ type: "text", text: "Delivered" }] };
        }

        return {
          content: [{ type: "text", text: "No pending request to reply to" }],
          isError: true,
        };
      },
    );
  }
}
