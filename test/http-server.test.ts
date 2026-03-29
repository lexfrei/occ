import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { HttpServer } from "../src/http-server.js";

describe("HttpServer", () => {
  const port = 19_876;
  const testConfig = {
    port,
    apiToken: "test-token",
    openclawUrl: "http://127.0.0.1:18789",
    openclawToken: undefined,
    replyTimeoutMs: 120_000,
  } as const;
  let server: HttpServer = new HttpServer(testConfig);

  beforeAll(() => {
    server = new HttpServer(testConfig);
    server.onCompletion((context) => Promise.resolve(`echo: ${context.userMessage}`));
    server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("rejects unauthenticated requests", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(response.status).toBe(401);
  });

  it("returns non-streaming completion", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: "hello world" }],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body["model"]).toBe("claude-code");

    const choices = body["choices"] as { message: { content: string } }[];

    expect(choices[0]?.message.content).toBe("echo: hello world");
  });

  it("returns streaming completion", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: "stream test" }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const text = await response.text();

    expect(text).toContain("echo: stream test");
    expect(text).toContain("data: [DONE]");
  });

  it("streams long response in multiple chunks without extra spaces", async () => {
    const longMessage =
      "The quick brown fox jumps over the lazy dog and then runs around the park several times before resting.";

    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: longMessage }],
        stream: true,
      }),
    });

    const text = await response.text();
    const dataLines = text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]");

    // Should have multiple content chunks (role + N content + done)
    expect(dataLines.length).toBeGreaterThan(2);

    // Reconstruct full text from deltas
    let reconstructed = "";

    for (const line of dataLines) {
      const json = JSON.parse(line.slice(6)) as { choices: { delta: { content?: string } }[] };
      const delta = json.choices[0]?.delta.content;

      if (delta) {
        reconstructed += delta;
      }
    }

    expect(reconstructed).toBe(`echo: ${longMessage}`);
  });

  it("streams text with no spaces correctly (hard-split)", async () => {
    const noSpaces = "a".repeat(120);

    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "user", content: noSpaces }],
        stream: true,
      }),
    });

    const text = await response.text();
    const dataLines = text
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]");

    let reconstructed = "";

    for (const line of dataLines) {
      const json = JSON.parse(line.slice(6)) as { choices: { delta: { content?: string } }[] };
      const delta = json.choices[0]?.delta.content;

      if (delta) {
        reconstructed += delta;
      }
    }

    expect(reconstructed).toBe(`echo: ${noSpaces}`);
  });

  it("returns model list", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/models`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { id: string }[] };

    expect(body.data[0]?.id).toBe("claude-code");

    const model = body.data[0] as Record<string, unknown>;

    expect(model["context_window"]).toBe(200_000);
    expect(model["max_output_tokens"]).toBe(16_384);
  });

  it("returns health on GET /health", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean };

    expect(body.ok).toBe(true);
  });

  it("returns health on GET /healthz", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);

    expect(response.status).toBe(200);
  });

  it("rejects POST to /health", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`, { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("rejects empty user message", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({
        model: "claude-code",
        messages: [{ role: "system", content: "you are helpful" }],
      }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 for valid JSON without messages field", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ model: "test" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 for messages with invalid elements", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: JSON.stringify({ model: "test", messages: [null, 42] }),
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
      },
      body: "not json at all",
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { type: string } };

    expect(body.error.type).toBe("invalid_request_error");
  });
});
