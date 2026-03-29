/**
 * Claude Code Channel MCP server.
 *
 * Declares claude/channel capability, pushes inbound messages
 * as channel notifications, and exposes reply/react tools.
 *
 * Uses McpServer high-level API for tool registration, and accesses
 * the underlying Server for channel notifications (experimental capability).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { type InboundMessage, type OutboundReply } from "./types.js";

const CHANNEL_INSTRUCTIONS = [
  "You are connected to OpenClaw via the OCC bridge.",
  'Messages from users arrive as <channel source="occ" ...> tags.',
  "",
  "Attributes on the tag:",
  "- platform: the messenger (telegram, whatsapp, discord, etc.)",
  "- sender: display name",
  "- senderId: platform user ID",
  "- chatId: use this to reply",
  "",
  "To respond, call the `reply` tool with `chatId` and `text`.",
  'For permission prompts, the user will reply with "yes <id>" or "no <id>".',
].join("\n");

type ReplyHandler = (reply: OutboundReply) => Promise<void>;

export class McpChannel {
  private readonly mcpServer: McpServer;
  private replyHandler: ReplyHandler | undefined;

  constructor() {
    this.mcpServer = new McpServer(
      { name: "occ", version: "0.0.1" },
      {
        capabilities: {
          experimental: {
            "claude/channel": {},
            "claude/channel/permission": {},
          },
        },
        instructions: CHANNEL_INSTRUCTIONS,
      },
    );

    this.registerTools();
  }

  /** Set the handler for outbound replies from Claude Code. */
  onReply(handler: ReplyHandler): void {
    this.replyHandler = handler;
  }

  /** Push an inbound message to Claude Code as a channel notification. */
  async pushMessage(message: InboundMessage): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: message.content,
        meta: {
          platform: message.platform,
          sender: message.senderName,
          senderId: message.senderId,
          chatId: message.chatId,
          timestamp: message.timestamp,
        },
      },
    });

    console.error(
      `[occ] pushed message from ${message.senderName} (${message.platform}) to Claude`,
    );
  }

  /** Push a permission prompt to Claude Code's channel. */
  async pushPermissionPrompt(text: string, chatId: string): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: text,
        meta: {
          chatId,
          type: "permissionPrompt",
        },
      },
    });
  }

  /** Send a permission verdict back to Claude Code. */
  async sendPermissionVerdict(requestId: string, behavior: "allow" | "deny"): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel/permission",
      params: {
        request_id: requestId,
        behavior,
      },
    });

    console.error(`[occ] permission verdict: ${behavior} for ${requestId}`);
  }

  /** Connect the MCP server to stdio transport. */
  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("[occ] MCP channel connected via stdio");
  }

  private registerTools(): void {
    this.mcpServer.registerTool(
      "reply",
      {
        description:
          "Send a text message back to a user through OpenClaw. " +
          "Use the chatId from the incoming <channel> tag.",
        inputSchema: {
          chatId: z.string().describe("The chatId from the incoming channel message"),
          text: z.string().describe("The response text to send"),
        },
      },
      async ({ chatId, text }) => {
        if (!this.replyHandler) {
          return {
            content: [{ type: "text", text: "No reply handler configured" }],
            isError: true,
          };
        }

        try {
          await this.replyHandler({ chatId, text });
          return {
            content: [{ type: "text", text: "Message sent" }],
          };
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: `Failed to send: ${errorMessage}` }],
            isError: true,
          };
        }
      },
    );
  }
}
