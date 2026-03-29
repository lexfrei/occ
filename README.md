# OCC — OpenClaw-Claude Connector

Use Claude Code as the brain behind your OpenClaw messengers.

OCC bridges [Claude Code Channels](https://code.claude.com/docs/en/channels) and [OpenClaw](https://openclaw.ai/) Gateway, letting you talk to your Claude Code session from any of OpenClaw's 25+ messenger integrations — Telegram, WhatsApp, Discord, Slack, Signal, Matrix, and more. Claude replies with full project context, your MCP tools, and your local files, just like being at the terminal.

> **Personal use only.** OCC is designed for a single account holder to interact with their own Claude Code session through OpenClaw's messenger integrations — the same model as the [official Telegram plugin](https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/telegram). Sharing access to Claude through OCC with other users violates [Anthropic's Consumer Terms](https://www.anthropic.com/legal/consumer-terms) ("you may not make your Account available to anyone else"). Always restrict the sender allowlist to your own accounts.[^1]

## Why OCC

Claude Code already ships with official channel plugins for Telegram, Discord, and iMessage. OCC exists because OpenClaw supports far more platforms — if you use WhatsApp, Signal, Slack, Matrix, IRC, Microsoft Teams, or any other messenger that OpenClaw integrates with, OCC lets you reach Claude Code from there too.

|           | Official Telegram plugin   | OCC via OpenClaw                           |
| --------- | -------------------------- | ------------------------------------------ |
| Platforms | Telegram only              | 25+ (anything OpenClaw supports)           |
| Setup     | BotFather token            | OpenClaw Gateway token                     |
| Runs as   | Claude Code Channel plugin | Claude Code Channel (development)          |
| Protocol  | Direct Telegram Bot API    | OpenClaw Gateway WebSocket (REST fallback) |

Both approaches use the same Claude Code Channels MCP protocol and the same sender allowlist security model.

## Architecture

```text
You on Telegram / WhatsApp / Discord / Signal / Slack / ...
    ↕  (native platform integrations)
OpenClaw Gateway (localhost:18789)
    ↕  (WebSocket with Ed25519 device auth, or REST API polling fallback)
OCC (single TypeScript process, Bun runtime)
    ↕  (stdio MCP, JSON-RPC 2.0)
Your Claude Code session
    (project context, local files, git, MCP tools — everything you have at the terminal)
```

OCC is a single process with two roles:

- **Claude Code Channel** — an [MCP server](https://modelcontextprotocol.io/) declaring the `claude/channel` experimental capability. Pushes inbound messages as `notifications/claude/channel` and exposes a `reply` tool that Claude calls to respond.
- **OpenClaw client** — connects to the Gateway via WebSocket (with Ed25519 device authentication) for real-time message delivery, or falls back to REST API polling. Replies go back through the same transport.

Messages flow through the bridge without storage — OCC holds no conversation history beyond an in-memory session map for routing replies to the correct chat.

## Requirements

- [Claude Code](https://code.claude.com/) v2.1.80+ authenticated with claude.ai (Pro or Max subscription)
- [OpenClaw](https://openclaw.ai/) running locally with at least one messenger channel configured
- [Bun](https://bun.sh/) 1.0+

## Quick start

**1. Clone and install**

```bash
git clone https://github.com/lexfrei/occ.git
cd occ
bun install
```

**2. Set your OpenClaw Gateway token**

Find it in `~/.openclaw/openclaw.json` under `gateway.auth.token`, or set `OPENCLAW_GATEWAY_TOKEN` in your environment:

```bash
export OPENCLAW_GATEWAY_TOKEN="your-token"
```

**3. Lock the sender allowlist to your own IDs**

```bash
export OCC_ALLOWED_SENDERS="your-telegram-id,your-discord-id"
```

Find your platform IDs through OpenClaw's channel settings. Each platform uses its own ID format (Telegram numeric ID, Discord snowflake, etc.).

**4. Start OpenClaw with passthrough agent** (automated setup)

```bash
./scripts/setup-openclaw.sh
```

This generates a gateway token, creates a passthrough agent config (model: none), and starts OpenClaw in Docker. The token is saved to `.env` and `openclaw-data/.token`.

Or if you already have OpenClaw running, disable its built-in agent in `~/.openclaw/openclaw.json`:

```json
{
  "agent": {
    "model": "none"
  }
}
```

Without this, both OpenClaw's Pi agent and Claude Code will respond to every message.

**5. Start Claude Code with OCC**

```bash
export OPENCLAW_GATEWAY_TOKEN="$(cat openclaw-data/.token)"
claude --dangerously-load-development-channels server:occ
```

**6. Send a message from any OpenClaw-connected messenger**

Claude Code receives it as a `<channel source="occ">` event. Type a response in the terminal or let Claude handle it autonomously — the reply arrives back in your messenger.

## Configuration

All settings are environment variables. No config files.

| Variable                 | Required | Default                  | Description                                                    |
| ------------------------ | -------- | ------------------------ | -------------------------------------------------------------- |
| `OPENCLAW_GATEWAY_TOKEN` | **Yes**  | —                        | Bearer token for OpenClaw Gateway authentication               |
| `OCC_ALLOWED_SENDERS`    | No       | `*` (allow all)          | Comma-separated platform sender IDs for your accounts          |
| `OCC_OPENCLAW_URL`       | No       | `http://127.0.0.1:18789` | OpenClaw Gateway URL                                           |
| `OCC_SESSION_KEY`        | No       | `main`                   | Session keys to monitor (comma-separated for multi-session)    |
| `OCC_TRANSPORT`          | No       | `auto`                   | Transport: `ws` (WebSocket), `rest` (polling), `auto` (try WS) |
| `OCC_POLL_INTERVAL_MS`   | No       | `2000`                   | How often to check for new messages (REST only, ms)            |
| `OCC_SESSION_TTL_MS`     | No       | `86400000`               | Inactive session cleanup threshold (24h)                       |

`OCC_OPENCLAW_TOKEN` is accepted as an alias for `OPENCLAW_GATEWAY_TOKEN`. If both are set, the standard OpenClaw variable takes precedence.

Multi-session example: `OCC_SESSION_KEY="main,work,personal"` monitors all three sessions simultaneously.

## Security model

OCC inherits the sender allowlist model from Claude Code Channels:

- **Sender gating** — only platform user IDs listed in `OCC_ALLOWED_SENDERS` can push messages into your session. Everyone else is silently dropped. Set this to your own IDs on each platform.
- **Gate on sender, not room** — in group chats, the sender's ID is checked, not the room ID. This prevents other people in a shared channel from injecting messages.
- **Permission relay** — if Claude Code hits a permission prompt (e.g., wanting to run a shell command), OCC forwards the prompt to your messenger. Reply `yes <code>` or `no <code>` to approve or deny remotely. Since anyone on the allowlist can approve tool use, only add IDs you control.
- **No token storage** — OCC never stores your OpenClaw token on disk. It reads from the environment at startup. The Ed25519 device key pair for WebSocket authentication is stored in `~/.config/occ/device-keys.json` with `0600` permissions.
- **`*` is for development only** — leaving `OCC_ALLOWED_SENDERS` unset or set to `*` disables gating entirely. This is convenient for testing but should never be used in a real setup.

## MCP tools

OCC exposes one tool to Claude Code:

| Tool    | Parameters                         | Description                                                   |
| ------- | ---------------------------------- | ------------------------------------------------------------- |
| `reply` | `chatId` (string), `text` (string) | Send a response back through OpenClaw to the originating chat |

Claude sees inbound messages as `<channel source="occ" platform="telegram" sender="You" chatId="telegram:12345:main">` tags with all routing metadata. It uses the `chatId` attribute when calling `reply`.

## Project structure

```text
src/
  index.ts              Entry point — loads config, starts bridge
  bridge.ts             Orchestration: wires all modules together
  mcp-channel.ts        MCP server with claude/channel capability
  gateway-ws.ts         WebSocket client with Ed25519 device auth
  openclaw-client.ts    REST API polling client (fallback transport)
  device-identity.ts    Ed25519 key generation, storage, and signing
  session-map.ts        Chat ID ↔ OpenClaw session mapping
  security.ts           Sender allowlist gate
  permission-relay.ts   Permission verdict parsing and formatting
  config.ts             Environment variable loader
  types.ts              Shared TypeScript types
  errors.ts             Shared error message extraction utility
test/
  config.test.ts                 Config loader tests
  security.test.ts               Sender gate tests
  session-map.test.ts            Session mapping tests
  permission-relay.test.ts       Permission parsing tests
  device-identity.test.ts        Ed25519 key and signing tests
  device-identity-validation.test.ts  Corrupted key file recovery tests
  bridge.test.ts                 Security: gate-before-verdict ordering
```

## Development

```bash
bun run check       # typecheck + lint + test (run all three)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint (strict) + prettier
bun run lint:fix     # auto-fix what can be fixed
bun run test         # bun test
```

Linting is intentionally strict: `eslint.configs.all` + `typescript-eslint/strict-type-checked` + `unicorn/all` + `sonarjs` + `import-x` + `promise` + `prettier`. The config mirrors the `default: all` philosophy from [golangci-lint](https://golangci-lint.run/).

## Limitations

- **Research preview** — Claude Code Channels are in [research preview](https://code.claude.com/docs/en/channels#research-preview). The `--dangerously-load-development-channels` flag syntax and protocol may change.
- **Development channel** — OCC uses `--dangerously-load-development-channels` because it is not on the Anthropic plugin allowlist. This requires confirmation at startup.

## License

[BSD-3-Clause](LICENSE)

[^1]: Claude Code Channels are an official Anthropic feature with built-in sender gating. OCC inherits this security model: only sender IDs you explicitly allowlist can push messages into your session. Configure `OCC_ALLOWED_SENDERS` with your own platform IDs and do not add other people.
