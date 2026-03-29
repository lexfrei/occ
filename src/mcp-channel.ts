/**
 * Claude Code Channel MCP server.
 *
 * Uses McpServer high-level API for tool registration, and accesses
 * the underlying Server.notification() for channel events (experimental capability).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toErrorMessage } from "./errors.js";
import { type InboundMessage, type OutboundReply, type PermissionBehavior } from "./types.js";
import { VERSION } from "./version.js";

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
      { name: "occ", version: VERSION },
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

  onReply(handler: ReplyHandler): void {
    this.replyHandler = handler;
  }

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

  async pushPermissionPrompt(text: string, chatId: string): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: text,
        meta: { chatId, type: "permissionPrompt" },
      },
    });
  }

  async sendPermissionVerdict(requestId: string, behavior: PermissionBehavior): Promise<void> {
    await this.mcpServer.server.notification({
      method: "notifications/claude/channel/permission",
      params: { request_id: requestId, behavior },
    });

    console.error(`[occ] permission verdict: ${behavior} for ${requestId}`);
  }

  async connect(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("[occ] MCP channel connected via stdio");
  }

  async close(): Promise<void> {
    await this.mcpServer.close();
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
          return { content: [{ type: "text", text: "Message sent" }] };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: `Failed to send: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      },
    );
  }
}
