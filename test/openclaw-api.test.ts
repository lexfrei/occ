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
});
