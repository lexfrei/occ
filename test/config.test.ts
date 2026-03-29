import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env["OPENCLAW_GATEWAY_TOKEN"];
    delete process.env["OCC_OPENCLAW_TOKEN"];
    delete process.env["OCC_OPENCLAW_URL"];
    delete process.env["OPENCLAW_GATEWAY_URL"];
    delete process.env["OCC_SESSION_KEY"];
    delete process.env["OCC_ALLOWED_SENDERS"];
    delete process.env["OCC_POLL_INTERVAL_MS"];
    delete process.env["OCC_SESSION_TTL_MS"];
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("throws when no token is provided", () => {
    expect(() => loadConfig()).toThrow("Missing required env var");
  });

  it("loads config with OPENCLAW_GATEWAY_TOKEN", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "test-token";

    const config = loadConfig();

    expect(config.openclawToken).toBe("test-token");
    expect(config.openclawUrl).toBe("http://127.0.0.1:18789");
    expect(config.sessionKey).toBe("main");
    expect(config.allowedSenders.size).toBe(0);
    expect(config.pollIntervalMs).toBe(2000);
  });

  it("loads config with OCC_OPENCLAW_TOKEN as fallback", () => {
    process.env["OCC_OPENCLAW_TOKEN"] = "fallback-token";

    const config = loadConfig();

    expect(config.openclawToken).toBe("fallback-token");
  });

  it("prefers OPENCLAW_GATEWAY_TOKEN over OCC_OPENCLAW_TOKEN", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "primary";
    process.env["OCC_OPENCLAW_TOKEN"] = "fallback";

    const config = loadConfig();

    expect(config.openclawToken).toBe("primary");
  });

  it("parses comma-separated allowed senders", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_ALLOWED_SENDERS"] = "user-1, user-2, user-3";

    const config = loadConfig();

    expect(config.allowedSenders.size).toBe(3);
    expect(config.allowedSenders.has("user-1")).toBe(true);
    expect(config.allowedSenders.has("user-2")).toBe(true);
    expect(config.allowedSenders.has("user-3")).toBe(true);
  });

  it("treats * as allow-all (empty set)", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_ALLOWED_SENDERS"] = "*";

    const config = loadConfig();

    expect(config.allowedSenders.size).toBe(0);
  });

  it("respects custom URL and session key", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_OPENCLAW_URL"] = "https://custom:9999";
    process.env["OCC_SESSION_KEY"] = "custom-session";

    const config = loadConfig();

    expect(config.openclawUrl).toBe("https://custom:9999");
    expect(config.sessionKey).toBe("custom-session");
  });

  it("respects custom poll interval", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_POLL_INTERVAL_MS"] = "5000";

    const config = loadConfig();

    expect(config.pollIntervalMs).toBe(5000);
  });

  it("parses OCC_TRANSPORT=ws", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_TRANSPORT"] = "ws";

    const config = loadConfig();

    expect(config.transport).toBe("ws");
  });

  it("parses OCC_TRANSPORT=rest", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_TRANSPORT"] = "rest";

    const config = loadConfig();

    expect(config.transport).toBe("rest");
  });

  it("defaults OCC_TRANSPORT to auto for invalid values", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_TRANSPORT"] = "invalid";

    const config = loadConfig();

    expect(config.transport).toBe("auto");
  });

  it("defaults OCC_TRANSPORT to auto when unset", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";

    const config = loadConfig();

    expect(config.transport).toBe("auto");
  });

  it("respects custom session TTL", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "token";
    process.env["OCC_SESSION_TTL_MS"] = "3600000";

    const config = loadConfig();

    expect(config.sessionTtlMs).toBe(3_600_000);
  });

  it("stores token in config correctly", () => {
    process.env["OPENCLAW_GATEWAY_TOKEN"] = "super-secret-token-12345";

    const config = loadConfig();

    expect(config.openclawToken).toBe("super-secret-token-12345");
  });
});
