/**
 * Claude Code Channel (MCP stdio).
 *
 * Pushes inbound messages as channel notifications.
 * Exposes tools:
 *   - reply: resolves pending HTTP response (synchronous reply)
 *   - notify: sends proactive message via OpenClaw API (async, no pending request needed)
 *   - send_file: sends file via OpenClaw API
 *   - react: adds/removes emoji reaction on a message
 *   - edit_message: edits a previously sent message
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toErrorMessage } from "./errors.js";
import { type ReactOptions, type SendMessageOptions } from "./types.js";
import { VERSION } from "./version.js";

const CHANNEL_INSTRUCTIONS = [
  "You are connected to OpenClaw via the OCC bridge.",
  'Messages from users arrive as <channel source="occ"> tags.',
  "",
  "Tools:",
  "- reply: respond to the current message (delivered as HTTP response to OpenClaw)",
  "- notify: send a proactive message (supports replyTo for threading, interactive for buttons)",
  "- send_file: send a file to a channel/user",
  "- react: add or remove an emoji reaction on a message",
  "- edit_message: edit a previously sent message",
].join("\n");

const GATEWAY_NOT_CONFIGURED = "Proactive messaging not configured. Set OPENCLAW_GATEWAY_TOKEN.";

const channelSchema = z
  .string()
  .min(1)
  .describe("Target channel: telegram, whatsapp, discord, slack, etc.");
const recipientSchema = z.string().min(1).describe("Recipient: chat ID, phone number, or user ID");

type ReplyCallback = (text: string) => void;
type NotifyCallback = (
  channel: string,
  to: string,
  text: string,
  options?: SendMessageOptions,
) => Promise<string>;
type SendFileCallback = (channel: string, to: string, filePath: string) => Promise<string>;
type ReactCallback = (
  channel: string,
  to: string,
  messageId: string,
  options: ReactOptions,
) => Promise<string>;
type EditMessageCallback = (
  channel: string,
  to: string,
  messageId: string,
  text: string,
) => Promise<string>;

export class McpChannel {
  private readonly mcpServer: McpServer;
  private pendingReply: ReplyCallback | undefined;
  private notifyHandler: NotifyCallback | undefined;
  private sendFileHandler: SendFileCallback | undefined;
  private reactHandler: ReactCallback | undefined;
  private editMessageHandler: EditMessageCallback | undefined;

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

    this.registerTools();
  }

  /** Set handler for notify tool (proactive messaging). */
  onNotify(handler: NotifyCallback): void {
    this.notifyHandler = handler;
  }

  /** Set handler for send_file tool. */
  onSendFile(handler: SendFileCallback): void {
    this.sendFileHandler = handler;
  }

  /** Set handler for react tool. */
  onReact(handler: ReactCallback): void {
    this.reactHandler = handler;
  }

  /** Set handler for edit_message tool. */
  onEditMessage(handler: EditMessageCallback): void {
    this.editMessageHandler = handler;
  }

  /** Push a user message into the Claude Code session with optional metadata. */
  async pushMessage(content: string, meta?: Record<string, string>): Promise<void> {
    console.error(`[occ] pushing notification: ${content.slice(0, 80)}`);

    try {
      await this.mcpServer.server.notification({
        method: "notifications/claude/channel",
        params: { content, ...(meta ? { meta } : {}) },
      });
      console.error("[occ] notification sent");
    } catch (error: unknown) {
      console.error(
        `[occ] notification FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Push a message and wait for Claude Code to call the reply tool.
   * The returned promise resolves with the reply text.
   */
  async pushAndWaitForReply(
    content: string,
    meta: Record<string, string>,
    timeoutMs: number,
  ): Promise<string> {
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

      this.pushMessage(content, meta).catch((error: unknown) => {
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

  private registerTools(): void {
    this.registerReplyTool();
    this.registerNotifyTool();
    this.registerSendFileTool();
    this.registerReactTool();
    this.registerEditMessageTool();
  }

  private registerReplyTool(): void {
    this.mcpServer.registerTool(
      "reply",
      {
        description:
          "Send a reply back to the user through OpenClaw (responds to current request).",
        inputSchema: {
          text: z.string().min(1).describe("The response text to send to the user"),
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

  private registerNotifyTool(): void {
    this.mcpServer.registerTool(
      "notify",
      {
        description:
          "Send a proactive message to a specific channel and user. " +
          "Supports threading (replyTo) and interactive content (buttons, selects). " +
          "Works anytime, not just during a request. " +
          "Requires OPENCLAW_GATEWAY_TOKEN to be configured.",
        inputSchema: {
          channel: channelSchema,
          to: recipientSchema,
          text: z.string().min(1).describe("The message text to send"),
          replyTo: z.string().optional().describe("Message ID to reply to (creates a thread)"),
          interactive: z
            .object({
              blocks: z
                .array(
                  z.object({
                    type: z.string().min(1).describe("Block type (common: buttons, select, text)"),
                    text: z.string().optional().describe("Text content for text blocks"),
                    buttons: z
                      .array(z.object({ label: z.string(), value: z.string() }))
                      .optional()
                      .describe("Button definitions for buttons blocks"),
                    options: z
                      .array(z.object({ label: z.string(), value: z.string() }))
                      .optional()
                      .describe("Select options for select blocks"),
                  }),
                )
                .min(1),
            })
            .optional()
            .describe("Interactive content: buttons and selects attached to the message"),
        },
      },
      async ({ channel, to, text, replyTo, interactive }) => {
        if (!this.notifyHandler) {
          return {
            content: [{ type: "text", text: GATEWAY_NOT_CONFIGURED }],
            isError: true,
          };
        }

        try {
          const options: SendMessageOptions | undefined =
            replyTo || interactive ? { replyTo, interactive } : undefined;
          const status = await this.notifyHandler(channel, to, text, options);
          return { content: [{ type: "text", text: status }] };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: `Failed: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      },
    );
  }

  private registerSendFileTool(): void {
    this.mcpServer.registerTool(
      "send_file",
      {
        description:
          "Send a file to a specific channel and user via OpenClaw. " +
          "Requires OPENCLAW_GATEWAY_TOKEN to be configured.",
        inputSchema: {
          channel: channelSchema,
          to: recipientSchema,
          filePath: z
            .string()
            .min(1)
            .describe("Path to the file (relative to project dir or absolute within it)"),
        },
      },
      async ({ channel, to, filePath }) => {
        if (!this.sendFileHandler) {
          return {
            content: [{ type: "text", text: GATEWAY_NOT_CONFIGURED }],
            isError: true,
          };
        }

        try {
          const status = await this.sendFileHandler(channel, to, filePath);
          return { content: [{ type: "text", text: status }] };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: `Failed: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      },
    );
  }

  private registerReactTool(): void {
    this.mcpServer.registerTool(
      "react",
      {
        description:
          "Add or remove an emoji reaction on a message. " +
          "Requires OPENCLAW_GATEWAY_TOKEN to be configured.",
        inputSchema: {
          channel: channelSchema,
          to: recipientSchema,
          messageId: z.string().min(1).describe("ID of the message to react to"),
          emoji: z.string().min(1).describe("Emoji to react with (e.g. thumbsup, heart, fire)"),
          remove: z
            .boolean()
            .optional()
            .describe("Set to true to remove the reaction instead of adding"),
        },
      },
      async ({ channel, to, messageId, emoji, remove }) => {
        if (!this.reactHandler) {
          return {
            content: [{ type: "text", text: GATEWAY_NOT_CONFIGURED }],
            isError: true,
          };
        }

        try {
          const status = await this.reactHandler(channel, to, messageId, {
            emoji,
            remove,
          });
          return { content: [{ type: "text", text: status }] };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: `Failed: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      },
    );
  }

  private registerEditMessageTool(): void {
    this.mcpServer.registerTool(
      "edit_message",
      {
        description:
          "Edit a previously sent message. Requires OPENCLAW_GATEWAY_TOKEN to be configured.",
        inputSchema: {
          channel: channelSchema,
          to: recipientSchema,
          messageId: z.string().min(1).describe("ID of the message to edit"),
          text: z.string().min(1).describe("New message text"),
        },
      },
      async ({ channel, to, messageId, text }) => {
        if (!this.editMessageHandler) {
          return {
            content: [{ type: "text", text: GATEWAY_NOT_CONFIGURED }],
            isError: true,
          };
        }

        try {
          const status = await this.editMessageHandler(channel, to, messageId, text);
          return { content: [{ type: "text", text: status }] };
        } catch (error: unknown) {
          return {
            content: [{ type: "text", text: `Failed: ${toErrorMessage(error)}` }],
            isError: true,
          };
        }
      },
    );
  }
}
