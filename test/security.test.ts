import { describe, expect, it } from "bun:test";

import { SenderGate } from "../src/security.js";
import { type InboundMessage } from "../src/types.js";

function makeMessage(senderId: string): InboundMessage {
  return {
    id: "test-1",
    platform: "telegram",
    senderName: "Test User",
    senderId,
    chatId: "chat-1",
    content: "hello",
    timestamp: new Date().toISOString(),
    sessionKey: "main",
  };
}

describe("SenderGate", () => {
  it("allows all senders when allowlist is empty", () => {
    const gate = new SenderGate(new Set());

    expect(gate.isAllowed(makeMessage("anyone"))).toBe(true);
    expect(gate.isOpen).toBe(true);
    expect(gate.allowlistSize).toBe(0);
  });

  it("allows senders in the allowlist", () => {
    const gate = new SenderGate(new Set(["user-1", "user-2"]));

    expect(gate.isAllowed(makeMessage("user-1"))).toBe(true);
    expect(gate.isAllowed(makeMessage("user-2"))).toBe(true);
  });

  it("blocks senders not in the allowlist", () => {
    const gate = new SenderGate(new Set(["user-1"]));

    expect(gate.isAllowed(makeMessage("user-2"))).toBe(false);
    expect(gate.isAllowed(makeMessage("unknown"))).toBe(false);
  });

  it("reports correct allowlist size", () => {
    const gate = new SenderGate(new Set(["a", "b", "c"]));

    expect(gate.allowlistSize).toBe(3);
    expect(gate.isOpen).toBe(false);
  });
});
