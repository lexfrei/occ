import { type OccConfig } from "./types.js";

const DEFAULT_PORT = 3456;
const DEFAULT_OPENCLAW_URL = "http://127.0.0.1:18789";
const DEFAULT_REPLY_TIMEOUT_MS = 120_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): OccConfig {
  const openclawToken = process.env["OPENCLAW_GATEWAY_TOKEN"];

  return {
    port: parsePositiveInt(process.env["OCC_PORT"], DEFAULT_PORT),
    apiToken: process.env["OCC_API_TOKEN"] ?? "occ-bridge-token",
    openclawUrl: process.env["OPENCLAW_GATEWAY_URL"] ?? DEFAULT_OPENCLAW_URL,
    openclawToken,
    replyTimeoutMs: parsePositiveInt(process.env["OCC_REPLY_TIMEOUT_MS"], DEFAULT_REPLY_TIMEOUT_MS),
  };
}
