import { type OccConfig } from "./types.js";

const DEFAULT_PORT = 3456;

export function loadConfig(): OccConfig {
  const apiToken = process.env["OCC_API_TOKEN"] ?? "occ-bridge-token";

  return {
    port: Number(process.env["OCC_PORT"]) || DEFAULT_PORT,
    apiToken,
  };
}
