/**
 * OCC — OpenClaw-Claude Connector
 *
 * OpenAI-compatible model provider that routes OpenClaw messages to Claude Code.
 * Runs as a Claude Code Channel (MCP stdio) and an HTTP server simultaneously.
 */

import { Bridge } from "./bridge.js";
import { loadConfig } from "./config.js";
import { toErrorMessage } from "./errors.js";
import { VERSION } from "./version.js";

async function shutdown(bridge: Bridge, signal: string): Promise<void> {
  console.error(`[occ] received ${signal}, shutting down...`);
  await bridge.stop();
  process.exit(0);
}

function main(): void {
  console.error(`[occ] OpenClaw-Claude Connector ${VERSION}`);

  const config = loadConfig();
  const bridge = new Bridge(config);

  let shuttingDown = false;

  const handleSignal = (signal: string): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    shutdown(bridge, signal).catch((error: unknown) => {
      console.error(`[occ] shutdown error: ${toErrorMessage(error)}`);
      process.exit(1);
    });
  };

  process.on("SIGINT", () => {
    handleSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    handleSignal("SIGTERM");
  });

  bridge.start().catch((error: unknown) => {
    console.error(`[occ] fatal: ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

main();
