/**
 * Bridge orchestration: wires MCP channel, OpenClaw transport,
 * session map, security gate, and permission relay together.
 */

import { toErrorMessage } from "./errors.js";
import { GatewayWebSocket } from "./gateway-ws.js";
import { McpChannel } from "./mcp-channel.js";
import { OpenClawClient } from "./openclaw-client.js";
import { parsePermissionVerdict } from "./permission-relay.js";
import { SenderGate } from "./security.js";
import { SessionMap } from "./session-map.js";
import { type InboundMessage, type OccConfig, type OutboundReply } from "./types.js";

interface Transport {
  onInboundMessage: (callback: (message: InboundMessage) => void) => void;
  start: () => Promise<void> | void;
  stop: () => void;
  sendReply: (sessionKey: string, text: string) => Promise<void>;
}

export class Bridge {
  private readonly channel: McpChannel;
  private transport: Transport;
  private readonly sessions: SessionMap;
  private readonly gate: SenderGate;
  private readonly config: OccConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: OccConfig) {
    this.config = config;
    this.channel = new McpChannel();
    this.sessions = new SessionMap(config.sessionTtlMs);
    this.gate = new SenderGate(config.allowedSenders);
    this.transport = this.createTransport(config.transport);
    this.wireHandlers();
  }

  async start(): Promise<void> {
    await this.channel.connect();
    await this.startTransport();

    if (this.gate.isOpen) {
      console.error("[occ] WARNING: sender gate is open — all senders allowed");
    } else {
      console.error(`[occ] sender gate: ${String(this.gate.allowlistSize)} senders allowed`);
    }

    this.startCleanup();
  }

  async stop(): Promise<void> {
    this.transport.stop();

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    try {
      await this.channel.close();
    } catch (error: unknown) {
      console.error(`[occ] MCP close error: ${toErrorMessage(error)}`);
    }
  }

  private createTransport(mode: OccConfig["transport"]): Transport {
    if (mode === "rest") {
      return new OpenClawClient(this.config);
    }

    return new GatewayWebSocket(this.config);
  }

  private wireHandlers(): void {
    this.transport.onInboundMessage((message: InboundMessage) => {
      this.handleInbound(message).catch((error: unknown) => {
        console.error(`[occ] inbound handler error: ${toErrorMessage(error)}`);
      });
    });

    this.channel.onReply((reply: OutboundReply) => this.handleOutbound(reply));
  }

  private async startTransport(): Promise<void> {
    const transportName = this.transport instanceof GatewayWebSocket ? "WebSocket" : "REST polling";

    try {
      await this.transport.start();
      console.error(`[occ] bridge started (transport: ${transportName})`);
    } catch (error: unknown) {
      if (this.config.transport === "auto") {
        console.error(
          `[occ] WebSocket failed (${toErrorMessage(error)}), falling back to REST polling`,
        );
        this.transport = new OpenClawClient(this.config);
        this.wireHandlers();
        await this.transport.start();
        console.error("[occ] bridge started (transport: REST polling, fallback)");
      } else {
        throw error;
      }
    }
  }

  private async handleInbound(message: InboundMessage): Promise<void> {
    if (!this.gate.isAllowed(message)) {
      console.error(
        `[occ] blocked message from ${message.senderId} (${message.platform}) — not in allowlist`,
      );
      return;
    }

    const verdict = parsePermissionVerdict(message.content);

    if (verdict) {
      await this.channel.sendPermissionVerdict(verdict.requestId, verdict.behavior);
      return;
    }

    const chatId = SessionMap.buildChatId(message.platform, message.senderId, message.sessionKey);
    this.sessions.upsert(chatId, {
      platform: message.platform,
      senderId: message.senderId,
      senderName: message.senderName,
      sessionKey: message.sessionKey,
    });

    await this.channel.pushMessage({ ...message, chatId });
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
