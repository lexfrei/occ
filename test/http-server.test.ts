import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { HttpServer } from "../src/http-server.js";

describe("HttpServer", () => {
  const port = 19_876;
  let server: HttpServer = new HttpServer({ port, apiToken: "test-token" });

  beforeAll(() => {
    server = new HttpServer({ port, apiToken: "test-token" });
    server.onCompletion((message) => Promise.resolve(`echo: ${message}`));
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

  it("returns model list", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/models`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { id: string }[] };

    expect(body.data[0]?.id).toBe("claude-code");
  });

  it("returns health", async () => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/health`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean };

    expect(body.ok).toBe(true);
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
});
