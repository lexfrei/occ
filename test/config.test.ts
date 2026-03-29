import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    delete process.env["OCC_API_TOKEN"];
    delete process.env["OCC_PORT"];
  });

  afterEach(() => {
    process.env = originalEnvironment;
  });

  it("returns defaults when no env vars are set", () => {
    const config = loadConfig();

    expect(config.port).toBe(3456);
    expect(config.apiToken).toBe("occ-bridge-token");
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
});
