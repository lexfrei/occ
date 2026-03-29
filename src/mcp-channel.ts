/**
 * Claude Code Channel (MCP stdio).
 *
 * Pushes inbound messages as channel notifications.
 * Exposes tools:
 *   - reply: resolves pending HTTP response (synchronous reply)
 *   - notify: sends proactive message via OpenClaw API (async, no pending request needed)
 *   - send_file: sends file via OpenClaw API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { toErrorMessage } from "./errors.js";
import { VERSION } from "./version.js";

const CHANNEL_INSTRUCTIONS = [
  "You are connected to OpenClaw via the OCC bridge.",
  'Messages from users arrive as <channel source="occ"> tags.',
  "",
  "Tools:",
  "- reply: respond to the current message (delivered as HTTP response to OpenClaw)",
  "- notify: send a proactive message to any channel/user (works anytime, not just during a request)",
  "- send_file: send a file to a channel/user",
].join("\n");

type ReplyCallback = (text: string) => void;
type NotifyCallback = (channel: string, to: string, text: string) => Promise<void>;
type SendFileCallback = (channel: string, to: string, filePath: string) => Promise<void>;

export class McpChannel {
  private readonly mcpServer: McpServer;
  private pendingReply: ReplyCallback | undefined;
  private notifyHandler: NotifyCallback | undefined;
  private sendFileHandler: SendFileCallback | undefined;

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
          "Works anytime, not just during a request. " +
          "Requires OPENCLAW_GATEWAY_TOKEN to be configured.",
        inputSchema: {
          channel: z
            .string()
            .min(1)
            .describe("Target channel: telegram, whatsapp, discord, slack, etc."),
          to: z.string().min(1).describe("Recipient: chat ID, phone number, or user ID"),
          text: z.string().min(1).describe("The message text to send"),
        },
      },
      async ({ channel, to, text }) => {
        if (!this.notifyHandler) {
          return {
            content: [
              {
                type: "text",
                text: "Proactive messaging not configured. Set OPENCLAW_GATEWAY_TOKEN.",
              },
            ],
            isError: true,
          };
        }

        try {
          await this.notifyHandler(channel, to, text);
          return { content: [{ type: "text", text: `Sent to ${channel}:${to}` }] };
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
          channel: z
            .string()
            .min(1)
            .describe("Target channel: telegram, whatsapp, discord, slack, etc."),
          to: z.string().min(1).describe("Recipient: chat ID, phone number, or user ID"),
          filePath: z
            .string()
            .min(1)
            .describe("Path to the file (relative to project dir or absolute within it)"),
        },
      },
      async ({ channel, to, filePath }) => {
        if (!this.sendFileHandler) {
          return {
            content: [
              {
                type: "text",
                text: "File sending not configured. Set OPENCLAW_GATEWAY_TOKEN.",
              },
            ],
            isError: true,
          };
        }

        try {
          await this.sendFileHandler(channel, to, filePath);
          return { content: [{ type: "text", text: `File sent to ${channel}:${to}` }] };
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
