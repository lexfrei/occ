---
name: configure
description: Configure OCC bridge connection to OpenClaw Gateway
user-invocable: true
---

# OCC Configuration

Set up the OCC bridge by configuring environment variables.

## Required

- `OPENCLAW_GATEWAY_TOKEN` — Bearer token for OpenClaw Gateway API authentication

## Optional

- `OCC_OPENCLAW_URL` — OpenClaw Gateway URL (default: `http://127.0.0.1:18789`)
- `OCC_SESSION_KEY` — Session keys to monitor, comma-separated (default: `main`)
- `OCC_ALLOWED_SENDERS` — Comma-separated sender IDs for allowlist, or `*` for all (default: allow all)
- `OCC_TRANSPORT` — Transport mode: `ws`, `rest`, or `auto` (default: `auto` — tries WebSocket, falls back to REST)
- `OCC_POLL_INTERVAL_MS` — Polling interval in milliseconds, REST only (default: `2000`)
- `OCC_SESSION_TTL_MS` — Session TTL in milliseconds (default: `86400000` / 24h)

## Quick Start

1. Set the token: `export OPENCLAW_GATEWAY_TOKEN="your-token-here"`
2. Start Claude Code with OCC channel: `claude --dangerously-load-development-channels server:occ`
3. Send a message through any OpenClaw-connected messenger
4. Claude Code receives it and can reply via the `reply` tool

## OpenClaw Setup

Configure OpenClaw to use a passthrough agent for sessions handled by OCC:

```json
{
  "agent": {
    "model": "none"
  }
}
```

This prevents double processing (both OpenClaw and Claude Code responding).
