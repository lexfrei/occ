import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { OpenClawApi } from "../src/openclaw-api.js";

describe("OpenClawApi", () => {
  const port = 19_877;
  let lastRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  } | null = null;

  let mockServer: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(() => {
    mockServer = Bun.serve({
      port,
      async fetch(request) {
        lastRequest = {
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text(),
        };

        const { body } = lastRequest;

        if (body.includes("trigger-error")) {
          return new Response("Internal Server Error", { status: 500 });
        }

        if (body.includes("with-id")) {
          return Response.json({
            ok: true,
            result: { details: { messageId: "msg-456", chatId: "123" } },
          });
        }

        return Response.json({ ok: true, result: {} });
      },
    });
  });

  afterAll(async () => {
    await mockServer?.stop();
  });

  it("sends message via /tools/invoke with auth header", async () => {
    const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "test-gw-token");

    const result = await api.sendMessage("telegram", "12345", "Hello from OCC");

    expect(result.delivered).toBe(true);
    expect(lastRequest?.method).toBe("POST");
    expect(lastRequest?.url).toContain("/tools/invoke");
    expect(lastRequest?.headers["authorization"]).toBe("Bearer test-gw-token");

    const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;

    expect(body["tool"]).toBe("message");
    expect(body["action"]).toBe("send");

    const args = body["args"] as Record<string, unknown>;

    expect(args["channel"]).toBe("telegram");
    expect(args["to"]).toBe("12345");
    expect(args["message"]).toBe("Hello from OCC");
  });

  it("returns messageId when API provides one", async () => {
    const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

    const result = await api.sendMessage("telegram", "123", "with-id test");

    expect(result.delivered).toBe(true);
    expect(result.messageId).toBe("msg-456");
  });

  it("returns undefined messageId when API omits it", async () => {
    const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

    const result = await api.sendMessage("telegram", "123", "no-id test");

    expect(result.delivered).toBe(true);
    expect(result.messageId).toBeUndefined();
  });

  it("throws on non-200 API response", async () => {
    const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

    try {
      await api.sendMessage("telegram", "123", "trigger-error");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("OpenClaw POST failed: 500");
    }
  });

  it("throws on connection error", async () => {
    const api = new OpenClawApi("http://127.0.0.1:1", "token");

    try {
      await api.sendMessage("telegram", "123", "fail");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  describe("sendMessage with options", () => {
    it("includes replyTo in args when provided", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.sendMessage("telegram", "123", "reply test", { replyTo: "msg-99" });

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(body["action"]).toBe("send");
      expect(args["replyTo"]).toBe("msg-99");
    });

    it("includes interactive blocks in args when provided", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");
      const interactive = {
        blocks: [{ type: "buttons", buttons: [{ label: "Yes", value: "yes" }] }],
      };

      await api.sendMessage("telegram", "123", "pick one", { interactive });

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(args["interactive"]).toEqual(interactive);
    });

    it("omits optional fields when not provided", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.sendMessage("telegram", "123", "plain text");

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(args["replyTo"]).toBeUndefined();
      expect(args["interactive"]).toBeUndefined();
    });
  });

  describe("reactToMessage", () => {
    it("sends react action with correct structure", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.reactToMessage("telegram", "123", "msg-1", { emoji: "thumbsup" });

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(body["tool"]).toBe("message");
      expect(body["action"]).toBe("react");
      expect(args["channel"]).toBe("telegram");
      expect(args["to"]).toBe("123");
      expect(args["messageId"]).toBe("msg-1");
      expect(args["emoji"]).toBe("thumbsup");
    });

    it("includes remove flag when set", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.reactToMessage("telegram", "123", "msg-1", { emoji: "heart", remove: true });

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(args["remove"]).toBe(true);
    });

    it("omits remove when not requested", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.reactToMessage("telegram", "123", "msg-1", { emoji: "fire" });

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(args["remove"]).toBeUndefined();
    });

    it("returns messageId from react response", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      const result = await api.reactToMessage("telegram", "123", "msg-1", {
        emoji: "with-id",
      });

      expect(result.delivered).toBe(true);
      expect(result.messageId).toBe("msg-456");
    });

    it("throws on react API error", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      try {
        await api.reactToMessage("telegram", "123", "msg-1", { emoji: "trigger-error" });
        expect.unreachable("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("OpenClaw POST failed: 500");
      }
    });
  });

  describe("editMessage", () => {
    it("sends edit action with correct structure", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      await api.editMessage("telegram", "123", "msg-1", "updated text");

      const body = JSON.parse(lastRequest?.body ?? "{}") as Record<string, unknown>;
      const args = body["args"] as Record<string, unknown>;

      expect(body["tool"]).toBe("message");
      expect(body["action"]).toBe("edit");
      expect(args["channel"]).toBe("telegram");
      expect(args["to"]).toBe("123");
      expect(args["messageId"]).toBe("msg-1");
      expect(args["message"]).toBe("updated text");
    });

    it("returns messageId from edit response", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      const result = await api.editMessage("telegram", "123", "msg-1", "with-id update");

      expect(result.delivered).toBe(true);
      expect(result.messageId).toBe("msg-456");
    });

    it("throws on edit API error", async () => {
      const api = new OpenClawApi(`http://127.0.0.1:${String(port)}`, "token");

      try {
        await api.editMessage("telegram", "123", "msg-1", "trigger-error");
        expect.unreachable("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("OpenClaw POST failed: 500");
      }
    });
  });
});
