/**
 * Bridge orchestration: wires MCP channel, OpenClaw client,
 * session map, security gate, and permission relay together.
 */

import { McpChannel } from "./mcp-channel.js";
import { OpenClawClient } from "./openclaw-client.js";
import { parsePermissionVerdict } from "./permission-relay.js";
import { SenderGate } from "./security.js";
import { SessionMap } from "./session-map.js";
import { type InboundMessage, type OccConfig, type OutboundReply } from "./types.js";

export class Bridge {
  private readonly channel: McpChannel;
  private readonly openClaw: OpenClawClient;
  private readonly sessions: SessionMap;
  private readonly gate: SenderGate;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: OccConfig) {
    this.channel = new McpChannel();
    this.openClaw = new OpenClawClient(config);
    this.sessions = new SessionMap(config.sessionTtlMs);
    this.gate = new SenderGate(config.allowedSenders);

    this.wireInbound();
    this.wireOutbound();
  }

  /** Start the bridge: connect MCP, start polling OpenClaw. */
  async start(): Promise<void> {
    await this.channel.connect();
    this.openClaw.start();
    this.startCleanup();

    console.error("[occ] bridge started");

    if (this.gate.isOpen) {
      console.error("[occ] WARNING: sender gate is open — all senders allowed");
    } else {
      console.error(`[occ] sender gate: ${String(this.gate.allowlistSize)} senders allowed`);
    }
  }

  /** Stop the bridge gracefully. */
  stop(): void {
    this.openClaw.stop();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private wireInbound(): void {
    this.openClaw.onInboundMessage((message: InboundMessage) => {
      this.handleInbound(message).catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[occ] inbound handler error: ${errorMessage}`);
      });
    });
  }

  private wireOutbound(): void {
    this.channel.onReply((reply: OutboundReply) => this.handleOutbound(reply));
  }

  private async handleInbound(message: InboundMessage): Promise<void> {
    const verdict = parsePermissionVerdict(message.content);

    if (verdict) {
      await this.channel.sendPermissionVerdict(verdict.requestId, verdict.behavior);
      return;
    }

    if (!this.gate.isAllowed(message)) {
      console.error(
        `[occ] blocked message from ${message.senderId} (${message.platform}) — not in allowlist`,
      );
      return;
    }

    const chatId = SessionMap.buildChatId(message.platform, message.senderId, message.sessionKey);
    this.sessions.upsert(chatId, {
      platform: message.platform,
      senderId: message.senderId,
      senderName: message.senderName,
      sessionKey: message.sessionKey,
    });

    const enrichedMessage: InboundMessage = {
      ...message,
      chatId,
    };

    await this.channel.pushMessage(enrichedMessage);
  }

  private async handleOutbound(reply: OutboundReply): Promise<void> {
    const session = this.sessions.get(reply.chatId);

    if (session) {
      await this.openClaw.sendReply(session.sessionKey, reply.text);
    } else {
      console.error(`[occ] no session found for chatId ${reply.chatId}, using as session key`);
      await this.openClaw.sendReply(reply.chatId, reply.text);
    }
  }

  private startCleanup(): void {
    const cleanupIntervalMs = 300_000;

    this.cleanupTimer = setInterval(() => {
      const removed = this.sessions.cleanup();

      if (removed > 0) {
        console.error(`[occ] cleaned up ${String(removed)} stale sessions`);
      }
    }, cleanupIntervalMs);
  }
}
