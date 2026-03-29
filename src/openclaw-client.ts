/**
 * OpenClaw Gateway REST API client.
 * Polls session history for inbound messages, posts responses for outbound delivery.
 */

import { toErrorMessage } from "./errors.js";
import { type InboundMessage, type OccConfig } from "./types.js";

interface HistoryEntry {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
  readonly timestamp?: string;
  readonly meta?: Record<string, string>;
}

interface HistoryResponse {
  readonly messages?: readonly HistoryEntry[];
}

type MessageCallback = (message: InboundMessage) => void;

const MAX_SEEN_IDS = 10_000;

function makeHeaders(token: string, json: boolean): Headers {
  const headers = new Headers({ authorization: `Bearer ${token}` });

  if (json) {
    headers.set("content-type", "application/json");
  }

  return headers;
}

export class OpenClawClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly sessionKey: string;
  private readonly pollIntervalMs: number;

  private onMessage: MessageCallback | undefined;
  private readonly seenIds = new Set<string>();
  private initialized = false;
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

  onInboundMessage(callback: MessageCallback): void {
    this.onMessage = callback;
  }

  start(): void {
    if (this.pollTimer) {
      return;
    }

    console.error(
      `[occ] polling OpenClaw at ${this.baseUrl} every ${String(this.pollIntervalMs)}ms`,
    );

    this.poll().catch((error: unknown) => {
      console.error(`[occ] initial poll error: ${toErrorMessage(error)}`);
    });

    this.pollTimer = setInterval(() => {
      this.poll().catch((error: unknown) => {
        console.error(`[occ] poll error: ${toErrorMessage(error)}`);
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async sendReply(sessionKey: string, text: string): Promise<void> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionKey)}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: makeHeaders(this.token, true),
      body: JSON.stringify({ message: text }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenClaw POST ${url} failed: ${String(response.status)} ${body}`);
    }

    console.error(`[occ] reply delivered to session ${sessionKey}`);
  }

  private async poll(): Promise<void> {
    const entries = await this.fetchHistory();
    const userMessages = entries.filter((entry) => entry.role === "user");

    if (!this.initialized) {
      for (const entry of userMessages) {
        this.seenIds.add(OpenClawClient.entryKey(entry));
      }

      this.initialized = true;
      return;
    }

    for (const entry of userMessages) {
      const key = OpenClawClient.entryKey(entry);

      if (!this.seenIds.has(key)) {
        this.seenIds.add(key);
        this.emitMessage(entry);
      }
    }

    this.evictOldIds();
  }

  private static entryKeyCounter = 0;

  private static entryKey(entry: HistoryEntry): string {
    if (entry.id) {
      return entry.id;
    }

    // Use a counter suffix to prevent collision when content or timestamps match
    OpenClawClient.entryKeyCounter += 1;
    const suffix = String(OpenClawClient.entryKeyCounter);

    if (entry.timestamp) {
      return `${entry.timestamp}:${suffix}`;
    }

    return `noid:${suffix}:${entry.content.slice(0, 32)}`;
  }

  /** Prevent unbounded memory growth by capping the seen IDs set. */
  private evictOldIds(): void {
    if (this.seenIds.size <= MAX_SEEN_IDS) {
      return;
    }

    const excess = this.seenIds.size - MAX_SEEN_IDS;
    const iterator = this.seenIds.values();
    let evicted = 0;

    while (evicted < excess) {
      const next = iterator.next();

      if (next.done) {
        break;
      }

      this.seenIds.delete(next.value);
      evicted += 1;
    }
  }

  private async fetchHistory(): Promise<readonly HistoryEntry[]> {
    const url = `${this.baseUrl}/api/sessions/${encodeURIComponent(this.sessionKey)}/history`;

    const response = await fetch(url, {
      headers: makeHeaders(this.token, false),
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
