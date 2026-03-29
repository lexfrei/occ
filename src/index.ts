/**
 * OCC — OpenClaw-Claude Connector
 *
 * Entry point: loads config, creates bridge, starts MCP channel + OpenClaw transport.
 */

import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { toErrorMessage } from "./errors.js";

function shutdown(bridge: Bridge, signal: string): void {
  console.error(`[occ] received ${signal}, shutting down...`);
  bridge.stop();
  process.exit(0);
}

function main(): void {
  console.error("[occ] OpenClaw-Claude Connector starting...");

  const config = loadConfig();

  console.error(`[occ] OpenClaw URL: ${config.openclawUrl}`);
  console.error(`[occ] Session key: ${config.sessionKey}`);

  const bridge = new Bridge(config);

  process.on("SIGINT", () => {
    shutdown(bridge, "SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown(bridge, "SIGTERM");
  });

  bridge.start().catch((error: unknown) => {
    console.error(`[occ] fatal: ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

main();
