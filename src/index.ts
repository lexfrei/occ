/**
 * OCC — OpenClaw-Claude Connector
 *
 * Entry point: loads config, creates bridge, starts MCP channel + OpenClaw polling.
 */

import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";

function main(): void {
  console.error("[occ] OpenClaw-Claude Connector starting...");

  const config = loadConfig();

  console.error(`[occ] OpenClaw URL: ${config.openclawUrl}`);
  console.error(`[occ] Session key: ${config.sessionKey}`);

  const bridge = new Bridge(config);

  process.on("SIGINT", () => {
    console.error("[occ] received SIGINT, shutting down...");
    bridge.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[occ] received SIGTERM, shutting down...");
    bridge.stop();
    process.exit(0);
  });

  bridge.start().catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[occ] fatal: ${errorMessage}`);
    process.exit(1);
  });
}

main();
