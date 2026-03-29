import { beforeEach, describe, expect, it } from "bun:test";

import { SessionMap } from "../src/session-map.js";

describe("SessionMap", () => {
  let sessions: SessionMap = new SessionMap(60_000);

  beforeEach(() => {
    sessions = new SessionMap(60_000);
  });

  describe("buildChatId", () => {
    it("builds deterministic chat ID from platform, sender, and session", () => {
      const chatId = SessionMap.buildChatId("telegram", "user-123", "main");

      expect(chatId).toBe("telegram:user-123:main");
    });
  });

  describe("upsert and get", () => {
    it("creates a new session on first upsert", () => {
      sessions.upsert("telegram:user-1:main", {
        platform: "telegram",
        senderId: "user-1",
        senderName: "Alice",
        sessionKey: "main",
      });

      const session = sessions.get("telegram:user-1:main");

      expect(session).toBeDefined();
      expect(session?.platform).toBe("telegram");
      expect(session?.senderName).toBe("Alice");
      expect(session?.messageCount).toBe(1);
    });

    it("increments message count on subsequent upserts", () => {
      const chatId = "telegram:user-1:main";
      const context = {
        platform: "telegram",
        senderId: "user-1",
        senderName: "Alice",
        sessionKey: "main",
      };

      sessions.upsert(chatId, context);
      sessions.upsert(chatId, context);
      sessions.upsert(chatId, context);

      expect(sessions.get(chatId)?.messageCount).toBe(3);
    });

    it("returns undefined for unknown chat ID", () => {
      expect(sessions.get("nonexistent")).toBeUndefined();
    });
  });

  describe("size", () => {
    it("tracks number of active sessions", () => {
      expect(sessions.size).toBe(0);

      sessions.upsert("a", {
        platform: "telegram",
        senderId: "1",
        senderName: "A",
        sessionKey: "main",
      });
      sessions.upsert("b", {
        platform: "discord",
        senderId: "2",
        senderName: "B",
        sessionKey: "main",
      });

      expect(sessions.size).toBe(2);
    });
  });

  describe("cleanup", () => {
    it("removes stale sessions older than TTL", () => {
      const shortTtl = new SessionMap(1);

      shortTtl.upsert("old", {
        platform: "telegram",
        senderId: "1",
        senderName: "Old",
        sessionKey: "main",
      });

      // Force the session to be old by manipulating lastActivityMs
      const session = shortTtl.get("old");
      if (session) {
        session.lastActivityMs = Date.now() - 100;
      }

      const removed = shortTtl.cleanup();

      expect(removed).toBe(1);
      expect(shortTtl.size).toBe(0);
    });

    it("keeps fresh sessions", () => {
      sessions.upsert("fresh", {
        platform: "telegram",
        senderId: "1",
        senderName: "Fresh",
        sessionKey: "main",
      });

      const removed = sessions.cleanup();

      expect(removed).toBe(0);
      expect(sessions.size).toBe(1);
    });
  });
});
