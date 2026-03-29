/**
 * Configuration loader. Reads from environment variables.
 */

import { type OccConfig, type TransportMode } from "./types.js";

const DEFAULT_OPENCLAW_URL = "http://127.0.0.1:18789";
const DEFAULT_SESSION_KEY = "main";
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_SESSION_TTL_MS = 86_400_000; // 24 hours

function parseAllowedSenders(raw: string | undefined): ReadonlySet<string> {
  if (!raw || raw.trim() === "" || raw.trim() === "*") {
    return new Set<string>();
  }

  return new Set(
    raw
      .split(",")
      .map((sender) => sender.trim())
      .filter((sender) => sender.length > 0),
  );
}

function parseTransport(raw: string | undefined): TransportMode {
  const value = raw?.trim().toLowerCase();

  if (value === "ws" || value === "rest") {
    return value;
  }

  return "auto";
}

export function loadConfig(): OccConfig {
  const openclawToken = process.env["OPENCLAW_GATEWAY_TOKEN"] ?? process.env["OCC_OPENCLAW_TOKEN"];

  if (!openclawToken) {
    throw new Error("Missing required env var: OPENCLAW_GATEWAY_TOKEN or OCC_OPENCLAW_TOKEN");
  }

  return {
    openclawUrl:
      process.env["OCC_OPENCLAW_URL"] ??
      process.env["OPENCLAW_GATEWAY_URL"] ??
      DEFAULT_OPENCLAW_URL,
    openclawToken,
    sessionKey: process.env["OCC_SESSION_KEY"] ?? DEFAULT_SESSION_KEY,
    allowedSenders: parseAllowedSenders(process.env["OCC_ALLOWED_SENDERS"]),
    pollIntervalMs: Number(process.env["OCC_POLL_INTERVAL_MS"]) || DEFAULT_POLL_INTERVAL_MS,
    sessionTtlMs: Number(process.env["OCC_SESSION_TTL_MS"]) || DEFAULT_SESSION_TTL_MS,
    transport: parseTransport(process.env["OCC_TRANSPORT"]),
  };
}
