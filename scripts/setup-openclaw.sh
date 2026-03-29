#!/usr/bin/env bash
# Headless OpenClaw setup for use with OCC.
# Creates config directories, generates a gateway token,
# writes a passthrough agent config, and starts the gateway.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DATA_DIR="${PROJECT_DIR}/openclaw-data"
WORKSPACE_DIR="${PROJECT_DIR}/openclaw-workspace"
TOKEN_FILE="${DATA_DIR}/.token"
CONFIG_FILE="${DATA_DIR}/openclaw.json"
ENV_FILE="${PROJECT_DIR}/.env"

mkdir -p "$DATA_DIR" "$WORKSPACE_DIR"

# Generate token if not exists
if [ ! -f "$TOKEN_FILE" ]; then
  TOKEN="occ-$(openssl rand -hex 24)"
  echo "$TOKEN" > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  echo "[setup] Generated gateway token"
else
  TOKEN="$(cat "$TOKEN_FILE")"
  echo "[setup] Using existing gateway token"
fi

# Write .env for docker compose
cat > "$ENV_FILE" << EOF
OPENCLAW_GATEWAY_TOKEN=${TOKEN}
EOF
echo "[setup] Wrote ${ENV_FILE}"

# Write OpenClaw config with passthrough agent
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" << 'JSON'
{
  "agent": {
    "model": "none"
  },
  "gateway": {
    "auth": {
      "mode": "token"
    }
  }
}
JSON
  echo "[setup] Wrote OpenClaw config (passthrough agent)"
else
  echo "[setup] OpenClaw config already exists, skipping"
fi

# Run onboard
echo "[setup] Running onboard..."
docker compose --file "${PROJECT_DIR}/compose.yaml" run \
  --rm --no-deps --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --no-install-daemon

# Start gateway
echo "[setup] Starting OpenClaw Gateway..."
docker compose --file "${PROJECT_DIR}/compose.yaml" up --detach openclaw-gateway

echo "[setup] Waiting for gateway to be healthy..."
timeout 60 bash -c 'until docker compose --file "'"${PROJECT_DIR}/compose.yaml"'" ps --format json | grep -q healthy; do sleep 2; done' || {
  echo "[setup] WARNING: Gateway health check timed out"
}

echo ""
echo "OpenClaw Gateway is running on http://127.0.0.1:18789"
echo ""
echo "To use with OCC:"
echo "  export OPENCLAW_GATEWAY_TOKEN=\"${TOKEN}\""
echo "  claude --dangerously-load-development-channels server:occ"
