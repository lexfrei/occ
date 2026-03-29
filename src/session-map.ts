/**
 * Session mapping: OpenClaw sessions ↔ Claude Code chat IDs.
 */

import { type SessionContext } from "./types.js";

export class SessionMap {
  private readonly sessions = new Map<string, SessionContext>();
  private readonly sessionTtlMs: number;

  constructor(sessionTtlMs: number) {
    this.sessionTtlMs = sessionTtlMs;
  }

  /** Build a deterministic chat ID from platform + sender + session. */
  static buildChatId(platform: string, senderId: string, sessionKey: string): string {
    return `${platform}:${senderId}:${sessionKey}`;
  }

  /** Register or update a session context for a chat ID. */
  upsert(chatId: string, context: Omit<SessionContext, "lastActivityMs" | "messageCount">): void {
    const existing = this.sessions.get(chatId);

    if (existing) {
      existing.lastActivityMs = Date.now();
      existing.messageCount += 1;
    } else {
      this.sessions.set(chatId, {
        ...context,
        lastActivityMs: Date.now(),
        messageCount: 1,
      });
    }
  }

  /** Look up session context by chat ID. */
  get(chatId: string): SessionContext | undefined {
    return this.sessions.get(chatId);
  }

  /** Remove stale sessions older than TTL. Returns count of removed entries. */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [chatId, context] of this.sessions) {
      if (now - context.lastActivityMs > this.sessionTtlMs) {
        this.sessions.delete(chatId);
        removed += 1;
      }
    }

    return removed;
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }
}
