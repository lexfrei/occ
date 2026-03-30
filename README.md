# OCC — OpenClaw-Claude Connector

Use Claude Code as the brain behind your OpenClaw messengers.

OCC is an [OpenAI-compatible model provider](https://docs.openclaw.ai/concepts/model-providers) that routes OpenClaw messages to a running Claude Code session. Register OCC as a model in OpenClaw, and every message from Telegram, WhatsApp, Discord, Slack, Signal, or any of OpenClaw's 25+ channels gets processed by Claude Code with full project context, local files, and MCP tools.

> **Personal use only.** OCC is designed for a single account holder to interact with their own Claude Code session through OpenClaw's messenger integrations. Sharing access to Claude through OCC with other users violates [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) ("you may not make your Account available to anyone else").[^1]

## How it works

```text
INCOMING (user → Claude Code):
  Telegram / WhatsApp / Discord / ...
      ↕ (native platform integrations)
  OpenClaw Gateway
      ↕ POST /v1/chat/completions (OpenAI-compatible HTTP)
  OCC (Bun HTTP server + Claude Code Channel)
      ↕ MCP stdio (JSON-RPC 2.0)
  Your Claude Code session (project files, git, MCP tools)

OUTGOING (Claude Code → user, synchronous reply):
  Claude Code → reply tool → OCC HTTP response → OpenClaw → messenger

PROACTIVE (Claude Code → user, anytime):
  Claude Code → notify/react/edit_message tool → OCC → POST /tools/invoke → OpenClaw → messenger

SCHEDULED (OpenClaw triggers Claude Code):
  OpenClaw cron/heartbeat → POST /v1/chat/completions → OCC → Claude Code
```

OCC is a single process with two interfaces:

- **HTTP server** — OpenClaw calls `POST /v1/chat/completions` as if OCC were any LLM provider
- **MCP Channel** — Claude Code spawns OCC as a subprocess and communicates via stdio

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

Option A — automated Docker setup:

```bash
./scripts/setup-openclaw.sh
```

Option B — manual config in `~/.openclaw/openclaw.json`:

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
  "agents": { "defaults": { "model": { "primary": "occ/claude-code" } } }
}
```

**3. Start Claude Code with OCC channel**

```bash
claude --dangerously-load-development-channels server:occ --permission-mode acceptEdits
```

**4. Send a message from any OpenClaw-connected messenger**

## MCP tools

Claude Code gets five tools through the OCC channel:

| Tool           | Parameters                                          | Description                                                                                        |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `reply`        | `text`                                              | Respond to the current message (synchronous, delivered as HTTP response)                           |
| `notify`       | `channel`, `to`, `text`, `replyTo?`, `interactive?` | Send a proactive message (supports threading via replyTo, buttons/selects via interactive)         |
| `send_file`    | `channel`, `to`, `filePath`                         | Read a local file, wrap in code fence with syntax highlighting (max 1MB, truncated to ~8000 chars) |
| `react`        | `channel`, `to`, `messageId`, `emoji`, `remove?`    | Add or remove an emoji reaction on a message                                                       |
| `edit_message` | `channel`, `to`, `messageId`, `text`                | Edit a previously sent message                                                                     |

`reply` works during an active request. All other tools work anytime — they call the OpenClaw REST API directly and require `OPENCLAW_GATEWAY_TOKEN`.

## Scheduling

OpenClaw's cron and heartbeat systems natively trigger the model provider. No OCC code changes needed.

**Cron** (exact schedule):

```bash
docker compose --profile cli run --rm openclaw-cli cron add \
  --schedule "*/10 * * * *" \
  --message "Check deploy status and notify me if anything failed"
```

**Heartbeat** (periodic check-ins): configure in your OpenClaw workspace's `HEARTBEAT.md`.

Both trigger `POST /v1/chat/completions` to OCC → Claude Code processes → reply delivered.

## Headless operation

For unattended use (tmux, remote VM, daemon), Claude Code needs auto-approved permissions. OCC ships with hooks that bypass all permission prompts:

```bash
./scripts/setup-openclaw.sh  # installs hooks automatically
```

Or manually:

```bash
mkdir -p .claude/hooks
cp hooks/auto-approve.sh hooks/auto-approve-permission.sh .claude/hooks/
```

Then add to `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash", "Edit", "Write", "Read", "WebFetch", "Agent", "mcp__occ__*"],
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

> **Run in an isolated environment.** Auto-approve hooks grant Claude Code unrestricted access to the filesystem, shell, and network. There are no guardrails — Claude Code can read, write, and execute anything. Always run OCC inside a dedicated VM or container (Colima, Docker, devcontainer), never on a host machine with access to sensitive data, credentials, or production infrastructure. You are solely responsible for any actions Claude Code takes.

## Configuration

| Variable                 | Default                  | Description                                                             |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------- |
| `OCC_PORT`               | `3456`                   | HTTP server port                                                        |
| `OCC_API_TOKEN`          | `occ-bridge-token`       | Bearer token OpenClaw sends (match `apiKey` in provider config)         |
| `OPENCLAW_GATEWAY_TOKEN` | —                        | OpenClaw gateway token (enables notify, send_file, react, edit_message) |
| `OPENCLAW_GATEWAY_URL`   | `http://127.0.0.1:18789` | OpenClaw gateway URL                                                    |
| `OCC_REPLY_TIMEOUT_MS`   | `120000`                 | Timeout for Claude Code to reply (ms)                                   |

## OpenAI-compatible API

| Endpoint               | Method | Description                                      |
| ---------------------- | ------ | ------------------------------------------------ |
| `/v1/chat/completions` | POST   | Chat completion (streaming and non-streaming)    |
| `/v1/models`           | GET    | List available models (with context window info) |
| `/health`, `/healthz`  | GET    | Health check                                     |

## Project structure

```text
src/
  index.ts          Entry point
  bridge.ts         Wires HTTP server, MCP channel, and OpenClaw API
  http-server.ts    OpenAI-compatible HTTP server (Bun.serve)
  mcp-channel.ts    Claude Code Channel (MCP stdio) with 5 tools (reply, notify, send_file, react, edit_message)
  openclaw-api.ts   OpenClaw REST API client for proactive messaging
  context.ts        Request context extraction and formatting
  config.ts         Environment variable loader
  file-validator.ts  File validation for send_file tool
  errors.ts         Shared error utility
  types.ts          Shared types
  version.ts        Version from package.json
hooks/
  auto-approve.sh              PreToolUse hook (auto-approve all tools)
  auto-approve-permission.sh   PermissionRequest hook (bypass .claude/ protection)
test/
  config.test.ts       Config tests
  http-server.test.ts  HTTP server tests
  context.test.ts      Context extraction tests
  openclaw-api.test.ts OpenClaw API client tests
  send-file.test.ts    File validation and path traversal tests
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
- **Sequential requests** — OCC handles one request at a time. A second message waits for the timeout (`OCC_REPLY_TIMEOUT_MS`, default 2 minutes).
- **No tool calling from OpenClaw** — custom model providers don't receive tool definitions from OpenClaw. Claude Code uses its own tools via MCP, not OpenClaw's.
- **System prompt partially forwarded** — first 500 chars of OpenClaw's system prompt forwarded as `[Agent context: ...]`. Full SOUL.md/MEMORY.md not available. Up to 3 preceding conversation messages included for context.
- **Images forwarded as URLs only** — image URLs from multimodal messages appear as `[Image: <url>]`. Claude Code cannot view the actual images.
- **Files sent as text** — `send_file` sends content as text in code fences. Binary attachment support (base64 buffer) is implemented but requires an upstream fix ([openclaw/openclaw#57335](https://github.com/openclaw/openclaw/pull/57335)).
- **Voice not transcribed** — voice messages arrive as placeholder text. Transcription depends on OpenClaw.
- **Session not resumable** — if Claude Code process dies, conversation context is lost. No auto-restart or state persistence.
- **Rate limits** — Claude Code Pro: ~10-40 prompts/5h, Max 5x: ~88K tokens. Each incoming message consumes at least one prompt.

## License

[BSD-3-Clause](LICENSE)

[^1]: OCC inherits the same usage model as the [official Telegram plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram) — one account holder interacting with their own Claude Code session through different interfaces.
