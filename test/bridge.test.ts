import { describe, expect, it } from "bun:test";

import { parsePermissionVerdict } from "../src/permission-relay.js";
import { SenderGate } from "../src/security.js";
import { type InboundMessage } from "../src/types.js";

function makeMessage(senderId: string, content: string): InboundMessage {
  return {
    id: "test-1",
    platform: "telegram",
    senderName: "Test User",
    senderId,
    chatId: "chat-1",
    content,
    timestamp: new Date().toISOString(),
    sessionKey: "main",
  };
}

describe("bridge security: sender gate before permission verdict", () => {
  it("blocks permission verdicts from unauthorized senders", () => {
    const gate = new SenderGate(new Set(["allowed-user"]));
    const message = makeMessage("attacker", "yes abcde");

    // The gate check must happen BEFORE verdict parsing.
    // If the sender is not allowed, the verdict must not be processed.
    const allowed = gate.isAllowed(message);

    expect(allowed).toBe(false);

    // Even though the message IS a valid verdict...
    const verdict = parsePermissionVerdict(message.content);

    expect(verdict).toEqual({ requestId: "abcde", behavior: "allow" });

    // ...it must be blocked by the gate (which runs first in the bridge).
  });

  it("allows permission verdicts from authorized senders", () => {
    const gate = new SenderGate(new Set(["trusted-user"]));
    const message = makeMessage("trusted-user", "no fghij");

    expect(gate.isAllowed(message)).toBe(true);

    const verdict = parsePermissionVerdict(message.content);

    expect(verdict).toEqual({ requestId: "fghij", behavior: "deny" });
  });
});

describe("bridge security: WS sender metadata and gating", () => {
  it("blocks messages with unknown senderId when allowlist is set", () => {
    const gate = new SenderGate(new Set(["specific-user-123"]));
    const wsMessage = makeMessage("unknown", "hello");

    expect(gate.isAllowed(wsMessage)).toBe(false);
  });

  it("allows messages with unknown senderId when gate is open", () => {
    const gate = new SenderGate(new Set());
    const wsMessage = makeMessage("unknown", "hello");

    expect(gate.isAllowed(wsMessage)).toBe(true);
  });
});
