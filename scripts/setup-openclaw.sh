#!/usr/bin/env bash
# Headless OpenClaw setup for use with OCC.
# Creates config, generates a gateway token, registers OCC as a model provider,
# and starts the gateway in Docker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

DATA_DIR="${PROJECT_DIR}/openclaw-data"
WORKSPACE_DIR="${PROJECT_DIR}/openclaw-workspace"
TOKEN_FILE="${DATA_DIR}/.token"
CONFIG_FILE="${DATA_DIR}/openclaw.json"
ENV_FILE="${PROJECT_DIR}/.env"

OCC_PORT="${OCC_PORT:-3456}"
OCC_API_TOKEN="${OCC_API_TOKEN:-occ-bridge-token}"

mkdir -p "$DATA_DIR" "$WORKSPACE_DIR"

# Generate gateway token if not exists
if [ ! -f "$TOKEN_FILE" ]; then
  TOKEN="occ-gw-$(openssl rand -hex 24)"
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

# Write OpenClaw config with OCC as model provider
cat > "$CONFIG_FILE" << EOF
{
  "gateway": {
    "mode": "local",
    "auth": {
      "mode": "token",
      "token": "${TOKEN}"
    },
    "controlUi": {
      "allowedOrigins": ["http://localhost:18789", "http://127.0.0.1:18789"]
    }
  },
  "models": {
    "providers": {
      "occ": {
        "baseUrl": "http://host.docker.internal:${OCC_PORT}/v1",
        "apiKey": "${OCC_API_TOKEN}",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-code",
            "name": "Claude Code (via OCC)",
            "contextWindow": 200000,
            "maxTokens": 16384
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "occ/claude-code"
      }
    }
  }
}
EOF
echo "[setup] Wrote OpenClaw config (OCC as model provider)"

# Install auto-approve hooks for headless operation
HOOKS_DIR="${PROJECT_DIR}/.claude/hooks"
mkdir -p "$HOOKS_DIR"
cp "${PROJECT_DIR}/hooks/auto-approve.sh" "$HOOKS_DIR/"
cp "${PROJECT_DIR}/hooks/auto-approve-permission.sh" "$HOOKS_DIR/"
chmod +x "$HOOKS_DIR"/*.sh

# Write Claude Code local settings with hooks
cat > "${PROJECT_DIR}/.claude/settings.local.json" << SETTINGS
{
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "Read", "WebFetch", "mcp__occ__reply", "Agent", "mcp__occ__*"],
    "defaultMode": "acceptEdits"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{"type": "command", "command": "${HOOKS_DIR}/auto-approve.sh"}]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [{"type": "command", "command": "${HOOKS_DIR}/auto-approve-permission.sh"}]
      }
    ]
  }
}
SETTINGS
echo "[setup] Installed auto-approve hooks"

# Start gateway
echo "[setup] Starting OpenClaw Gateway..."
docker compose --file "${PROJECT_DIR}/compose.yaml" up --detach openclaw-gateway

echo "[setup] Waiting for gateway health..."
timeout 60 bash -c 'until curl --silent --fail http://127.0.0.1:18789/healthz > /dev/null 2>&1; do sleep 2; done' || {
  echo "[setup] WARNING: Gateway health check timed out"
}

echo ""
echo "OpenClaw Gateway running on http://127.0.0.1:18789"
echo "OCC model provider configured at http://host.docker.internal:${OCC_PORT}/v1"
echo ""
echo "Next steps:"
echo "  1. Add a messenger channel: docker compose --profile cli run --rm openclaw-cli channels add --channel telegram --token <BOT_TOKEN>"
echo "  2. Restart gateway: docker compose restart openclaw-gateway"
echo "  3. Start Claude Code with OCC: claude --dangerously-load-development-channels server:occ --permission-mode acceptEdits"
