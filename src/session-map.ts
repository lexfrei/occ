import { type SessionContext } from "./types.js";

export class SessionMap {
  private readonly sessions = new Map<string, SessionContext>();
  private readonly sessionTtlMs: number;

  constructor(sessionTtlMs: number) {
    this.sessionTtlMs = sessionTtlMs;
  }

  static buildChatId(platform: string, senderId: string, sessionKey: string): string {
    return `${platform}:${senderId}:${sessionKey}`;
  }

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

  get(chatId: string): SessionContext | undefined {
    return this.sessions.get(chatId);
  }

  /** Remove sessions older than TTL. Returns count of removed entries. */
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

  get size(): number {
    return this.sessions.size;
  }
}
