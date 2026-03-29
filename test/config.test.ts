import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env["OCC_API_TOKEN"];
    delete process.env["OCC_PORT"];
    delete process.env["OPENCLAW_GATEWAY_TOKEN"];
    delete process.env["OPENCLAW_GATEWAY_URL"];
    delete process.env["OCC_REPLY_TIMEOUT_MS"];
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("returns defaults when no env vars are set", () => {
    const config = loadConfig();

    expect(config.port).toBe(3456);
    expect(config.apiToken).toBe("occ-bridge-token");
    expect(config.openclawUrl).toBe("http://127.0.0.1:18789");
    expect(config.openclawToken).toBeUndefined();
    expect(config.replyTimeoutMs).toBe(120_000);
  });

  it("respects custom port", () => {
    process.env["OCC_PORT"] = "8080";

    const config = loadConfig();

    expect(config.port).toBe(8080);
  });

  it("respects custom API token", () => {
    process.env["OCC_API_TOKEN"] = "my-secret";

    const config = loadConfig();

    expect(config.apiToken).toBe("my-secret");
  });

  it("loads OpenClaw gateway token", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "gw-token";

    const config = loadConfig();

    expect(config.openclawToken).toBe("gw-token");
  });

  it("loads OpenClaw gateway URL", () => {
    process.env["OPENCLAW_GATEWAY_URL"] = "https://openclaw.local:9999";

    const config = loadConfig();

    expect(config.openclawUrl).toBe("https://openclaw.local:9999");
  });

  it("loads custom reply timeout", () => {
    process.env["OCC_REPLY_TIMEOUT_MS"] = "60000";

    const config = loadConfig();

    expect(config.replyTimeoutMs).toBe(60_000);
  });

  it("reports proactive messaging as available when token is set", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";

    const config = loadConfig();

    expect(config.openclawToken).toBeDefined();
  });

  it("falls back to default for zero timeout", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_REPLY_TIMEOUT_MS"] = "0";

    const config = loadConfig();

    expect(config.replyTimeoutMs).toBe(120_000);
  });

  it("falls back to default for negative timeout", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_REPLY_TIMEOUT_MS"] = "-1";

    const config = loadConfig();

    expect(config.replyTimeoutMs).toBe(120_000);
  });

  it("reports proactive messaging as unavailable when token is missing", () => {
    const config = loadConfig();

    expect(config.openclawToken).toBeUndefined();
  });
});
