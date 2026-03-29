/**
 * OpenClaw Gateway REST API client.
 *
 * Handles inbound message polling (GET /api/sessions/:key/history)
 * and outbound response delivery (POST /api/sessions/:key/messages).
 */

import { type InboundMessage, type OccConfig } from "./types.js";

/** Raw transcript entry from OpenClaw history API. */
interface HistoryEntry {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
  readonly meta?: Record<string, string>;
}

/** Raw response from OpenClaw history API. */
interface HistoryResponse {
  readonly messages?: readonly HistoryEntry[];
}

type MessageCallback = (message: InboundMessage) => void;

function makeAuthHeaders(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

function makeJsonHeaders(token: string): Headers {
  return new Headers({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
}

export class OpenClawClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly sessionKey: string;
  private readonly pollIntervalMs: number;

  private onMessage: MessageCallback | undefined;
  private lastSeenId: string | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private messageIdCounter = 0;

  constructor(config: OccConfig) {
    let url = config.openclawUrl;
    while (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    this.baseUrl = url;
    this.token = config.openclawToken;
    this.sessionKey = config.sessionKey;
    this.pollIntervalMs = config.pollIntervalMs;
  }

  /** Register callback for inbound user messages. */
  onInboundMessage(callback: MessageCallback): void {
    this.onMessage = callback;
  }

  /** Start polling for new messages. */
  start(): void {
    if (this.pollTimer) {
      return;
    }

    console.error(
      `[occ] polling OpenClaw at ${this.baseUrl} every ${String(this.pollIntervalMs)}ms`,
    );

    this.poll().catch((error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[occ] initial poll error: ${errorMessage}`);
    });

    this.pollTimer = setInterval(() => {
      this.poll().catch((error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[occ] poll error: ${errorMessage}`);
      });
    }, this.pollIntervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** Send a response back through OpenClaw for delivery. */
  async sendReply(sessionKey: string, text: string): Promise<void> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionKey)}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: makeJsonHeaders(this.token),
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST ${url} failed: ${String(response.status)} ${body}`);
    }

    console.error(`[occ] reply delivered to session ${sessionKey}`);
  }

  /**
   * Send a reply via webhook for explicit channel delivery.
   * Uses POST /hooks/agent with deliver=true for targeted routing.
   */
  async sendReplyViaWebhook(text: string, channel: string, to: string): Promise<void> {
    const url = `${this.baseUrl}/hooks/agent`;

    const response = await fetch(url, {
      method: "POST",
      headers: makeJsonHeaders(this.token),
      body: JSON.stringify({
        message: text,
        deliver: true,
        channel,
        to,
        sessionKey: `occ:bridge:${channel}`,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw webhook ${url} failed: ${String(response.status)} ${body}`);
    }

    console.error(`[occ] webhook reply delivered to ${channel}:${to}`);
  }

  private async poll(): Promise<void> {
    const entries = await this.fetchHistory();
    const userMessages = entries.filter((entry) => entry.role === "user");

    for (const entry of userMessages) {
      const entryId = entry.id ?? entry.timestamp ?? "";

      if (this.lastSeenId === undefined) {
        this.lastSeenId = entryId;
      } else if (entryId !== this.lastSeenId) {
        this.lastSeenId = entryId;
        this.emitMessage(entry);
      }
    }
  }

  private async fetchHistory(): Promise<readonly HistoryEntry[]> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(this.sessionKey)}/history`;

    const response = await fetch(url, {
      headers: makeAuthHeaders(this.token),
    });

    if (!response.ok) {
      throw new Error(`OpenClaw GET ${url} failed: ${String(response.status)}`);
    }

    const data = (await response.json()) as HistoryResponse;
    return data.messages ?? [];
  }

  private emitMessage(entry: HistoryEntry): void {
    if (!this.onMessage) {
      return;
    }

    this.messageIdCounter += 1;

    const message: InboundMessage = {
      id: entry.id ?? `occ-${String(this.messageIdCounter)}`,
      platform: entry.meta?.["channel"] ?? "unknown",
      senderName: entry.meta?.["senderName"] ?? "Unknown",
      senderId: entry.meta?.["senderId"] ?? "unknown",
      chatId: entry.meta?.["chatId"] ?? this.sessionKey,
      content: entry.content,
      timestamp: entry.timestamp ?? new Date().toISOString(),
      sessionKey: this.sessionKey,
    };

    this.onMessage(message);
  }
}
