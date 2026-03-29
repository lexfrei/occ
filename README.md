# OCC — OpenClaw-Claude Connector

Use Claude Code as the brain behind your OpenClaw messengers.

OCC is an [OpenAI-compatible model provider](https://docs.openclaw.ai/concepts/model-providers) that routes OpenClaw messages to a running Claude Code session. Register OCC as a model in OpenClaw, and every message from Telegram, WhatsApp, Discord, Slack, Signal, or any of OpenClaw's 25+ channels gets processed by Claude Code with full project context, local files, and MCP tools.

> **Personal use only.** OCC is designed for a single account holder to interact with their own Claude Code session through OpenClaw's messenger integrations. Sharing access to Claude through OCC with other users violates [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) ("you may not make your Account available to anyone else").[^1]

## How it works

```text
You on Telegram / WhatsApp / Discord / Signal / Slack / ...
    ↕  (native platform integrations)
OpenClaw Gateway
    ↕  POST /v1/chat/completions (OpenAI-compatible HTTP)
OCC (Bun HTTP server + Claude Code Channel)
    ↕  MCP stdio (JSON-RPC 2.0)
Your Claude Code session
    (project files, git, MCP tools — full local context)
```

OCC is a single process with two interfaces:

- **HTTP server** — OpenClaw calls `POST /v1/chat/completions` as if OCC were any LLM provider
- **MCP Channel** — Claude Code spawns OCC as a subprocess and communicates via stdio

When a request arrives, OCC pushes the user message into the Claude Code session as a `<channel>` notification. Claude processes it with full context and calls the `reply` tool. OCC returns the reply as an OpenAI-format HTTP response back to OpenClaw, which delivers it to the messenger.

## Requirements

- [Claude Code](https://code.claude.com/) v2.1.80+ with claude.ai login (Pro or Max)
- [OpenClaw](https://openclaw.ai/) with at least one messenger channel configured
- [Bun](https://bun.sh/) 1.0+

## Quick start

**1. Clone and install**

```bash
git clone https://github.com/lexfrei/occ.git
cd occ
bun install
```

**2. Start OpenClaw with OCC as model provider**

Option A — use the setup script (Docker):

```bash
./scripts/setup-openclaw.sh
```

Option B — configure manually in `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "occ": {
        "baseUrl": "http://127.0.0.1:3456/v1",
        "apiKey": "occ-bridge-token",
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
```

**3. Start Claude Code with OCC channel**

```bash
claude --dangerously-load-development-channels server:occ --permission-mode acceptEdits
```

Claude Code spawns OCC, which starts the HTTP server on port 3456. OpenClaw sends messages there, Claude Code processes them, replies go back to the messenger.

**4. Send a message from any OpenClaw-connected messenger**

## Headless operation

For unattended use (tmux, remote VM, daemon), Claude Code needs auto-approved permissions. OCC ships with hooks that bypass all permission prompts:

```bash
./scripts/setup-openclaw.sh  # installs hooks automatically
```

Or manually copy hooks and settings:

```bash
mkdir -p .claude/hooks
cp hooks/auto-approve.sh hooks/auto-approve-permission.sh .claude/hooks/
```

Then add to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "Read", "mcp__occ__reply"],
    "defaultMode": "acceptEdits"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": ".claude/hooks/auto-approve.sh" }]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": ".claude/hooks/auto-approve-permission.sh" }]
      }
    ]
  }
}
```

This gives Claude Code full autonomy — `PreToolUse` hook auto-approves all tool calls, `PermissionRequest` hook bypasses `.claude/` directory protection for skill and agent creation.

> **Single-tenant only.** Auto-approve hooks grant Claude Code unrestricted access to the filesystem, shell, and network. Use only in isolated environments (VMs, containers) where you are the sole operator and accept full responsibility for Claude Code's actions.

## Configuration

| Variable        | Default            | Description                                                          |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| `OCC_PORT`      | `3456`             | HTTP server port                                                     |
| `OCC_API_TOKEN` | `occ-bridge-token` | Bearer token OpenClaw sends (must match `apiKey` in provider config) |

## OpenAI-compatible API

OCC implements the subset of the OpenAI API that OpenClaw needs:

| Endpoint               | Method | Description                                   |
| ---------------------- | ------ | --------------------------------------------- |
| `/v1/chat/completions` | POST   | Chat completion (streaming and non-streaming) |
| `/v1/models`           | GET    | List available models                         |
| `/health`              | GET    | Health check                                  |

## Project structure

```text
src/
  index.ts          Entry point
  bridge.ts         Wires HTTP server to MCP channel
  http-server.ts    OpenAI-compatible HTTP server (Bun.serve)
  mcp-channel.ts    Claude Code Channel (MCP stdio)
  config.ts         Environment variable loader
  errors.ts         Shared error utility
  types.ts          Shared types
  version.ts        Version from package.json
hooks/
  auto-approve.sh              PreToolUse hook (auto-approve all tools)
  auto-approve-permission.sh   PermissionRequest hook (bypass .claude/ protection)
test/
  config.test.ts       Config loader tests
  http-server.test.ts  HTTP server tests (auth, streaming, errors)
```

## Development

```bash
bun run check       # typecheck + lint + test
bun run typecheck    # tsc --noEmit
bun run lint         # eslint (strict) + prettier
bun run test         # bun test
```

## Limitations

- **Research preview** — Claude Code Channels are in [research preview](https://code.claude.com/docs/en/channels#research-preview). The `--dangerously-load-development-channels` flag and protocol may change.
- **Sequential requests** — OCC handles one request at a time. If OpenClaw sends a second message while Claude Code is still processing the first, it waits (up to 2 minutes).

## License

[BSD-3-Clause](LICENSE)

[^1]: OCC inherits the same usage model as the [official Telegram plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) — one account holder interacting with their own Claude Code session through different interfaces.
