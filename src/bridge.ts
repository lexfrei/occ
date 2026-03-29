/**
 * Bridge orchestration: wires MCP channel, OpenClaw client (REST or WS),
 * session map, security gate, and permission relay together.
 */

import { GatewayWebSocket } from "./gateway-ws.js";
import { McpChannel } from "./mcp-channel.js";
import { OpenClawClient } from "./openclaw-client.js";
import { parsePermissionVerdict } from "./permission-relay.js";
import { SenderGate } from "./security.js";
import { SessionMap } from "./session-map.js";
import { type InboundMessage, type OccConfig, type OutboundReply } from "./types.js";

/** Common interface for both REST and WS transports. */
interface Transport {
  onInboundMessage: (callback: (message: InboundMessage) => void) => void;
  start: () => Promise<void> | void;
  stop: () => void;
  sendReply: (sessionKey: string, text: string) => Promise<void>;
}

export class Bridge {
  private readonly channel: McpChannel;
  private readonly transport: Transport;
  private readonly sessions: SessionMap;
  private readonly gate: SenderGate;
  private readonly transportName: string;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: OccConfig) {
    this.channel = new McpChannel();
    this.sessions = new SessionMap(config.sessionTtlMs);
    this.gate = new SenderGate(config.allowedSenders);

    if (config.transport === "rest") {
      this.transport = new OpenClawClient(config);
      this.transportName = "REST polling";
    } else {
      this.transport = new GatewayWebSocket(config);
      this.transportName = "WebSocket";
    }

    this.wireInbound();
    this.wireOutbound();
  }

  /** Start the bridge: connect MCP, start transport. */
  async start(): Promise<void> {
    await this.channel.connect();

    try {
      await this.transport.start();
      console.error(`[occ] bridge started (transport: ${this.transportName})`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[occ] ${this.transportName} failed: ${errorMessage}`);
      throw error;
    }

    if (this.gate.isOpen) {
      console.error("[occ] WARNING: sender gate is open — all senders allowed");
    } else {
      console.error(`[occ] sender gate: ${String(this.gate.allowlistSize)} senders allowed`);
    }

    this.startCleanup();
  }

  /** Stop the bridge gracefully. */
  stop(): void {
    this.transport.stop();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private wireInbound(): void {
    this.transport.onInboundMessage((message: InboundMessage) => {
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
      await this.transport.sendReply(session.sessionKey, reply.text);
    } else {
      console.error(`[occ] no session found for chatId ${reply.chatId}, using as session key`);
      await this.transport.sendReply(reply.chatId, reply.text);
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
