# OCC Test Plan

Comprehensive test scenarios for the OCC bridge (OpenClaw ↔ Claude Code).

**Environment:** OpenClaw Gateway (Docker) + OCC (Claude Code Channel) + Telegram bot.
**Preconditions for all tests:** OpenClaw running, OCC connected, Telegram bot paired, auto-approve hooks installed.

## State Cleanup

Run between test sections or when tests produce unexpected results.

**Full stack restart (clean slate):**

```bash
# 1. Kill Claude Code + OCC
colima ssh -- bash -c "tmux kill-session -t occ 2>/dev/null"

# 2. Restart OpenClaw (clears session state, reconnects Telegram)
OPENCLAW_GATEWAY_TOKEN="$(cat /tmp/openclaw-data/.token)" docker compose restart openclaw-gateway

# 3. Wait for gateway + Telegram
sleep 15

# 4. Start Claude Code + OCC fresh
colima ssh -- bash -c '
export PATH=$HOME/.bun/bin:$PATH
export CLAUDE_CODE_OAUTH_TOKEN="<token>"
cd /tmp/occ
tmux new-session -d -s occ "claude --dangerously-load-development-channels server:occ --permission-mode acceptEdits"
'

# 5. Accept dev channel prompt
sleep 8 && colima ssh -- bash -c "tmux send-keys -t occ Enter"

# 6. Verify
sleep 12 && colima ssh -- bash -c "curl --silent http://127.0.0.1:3456/health"
```

**Quick OCC restart (keeps OpenClaw sessions):**

```bash
colima ssh -- bash -c "tmux kill-session -t occ 2>/dev/null"
# ... restart tmux with claude command ...
```

**Clear OpenClaw session history:**

```bash
OPENCLAW_GATEWAY_TOKEN="$(cat /tmp/openclaw-data/.token)" \
  docker compose --profile cli run --rm openclaw-cli sessions clear main
```

**When to clean state:**

- Before section 1 (core flow): full restart
- Before section 6 (sessions): full restart (session tests need clean history)
- Before section 7 (security): full restart (pairing state)
- Before section 9 (hooks): full restart (hook state cached)
- After any `[!]` failed test: full restart before retrying
- Between individual tests: usually not needed (tests are independent)

## Legend

- **P0** — critical, must pass for release
- **P1** — important, affects core functionality
- **P2** — medium, affects edge cases or secondary features
- **P3** — low, cosmetic or theoretical

Status: `[ ]` not tested, `[x]` passed, `[!]` failed, `[-]` not applicable, `[~]` partially passed

---

## 1. Core Message Flow (P0)

### 1.1 Basic request-response

| #     | Scenario                        | Steps                                     | Expected                                | Status |
| ----- | ------------------------------- | ----------------------------------------- | --------------------------------------- | ------ |
| 1.1.1 | Simple text message             | Send "Hello" to bot                       | Bot replies with a greeting             | `[x]`  |
| 1.1.2 | Question requiring reasoning    | Send "What is 2+2?"                       | Bot replies with "4" or explanation     | `[x]`  |
| 1.1.3 | Multi-sentence response         | Ask something requiring a detailed answer | Full response delivered, not truncated  | `[ ]`  |
| 1.1.4 | Non-English message             | Send "Привет, как дела?"                  | Bot replies in Russian                  | `[x]`  |
| 1.1.5 | Empty message                   | Send whitespace-only message              | Bot ignores or OpenClaw filters it      | `[ ]`  |
| 1.1.6 | Very long message (>4000 chars) | Send a large text block                   | Bot receives and processes full message | `[ ]`  |

### 1.2 Response delivery

| #     | Scenario                         | Steps                               | Expected                                                  | Status |
| ----- | -------------------------------- | ----------------------------------- | --------------------------------------------------------- | ------ |
| 1.2.1 | Short response                   | Ask "Say yes"                       | "Yes" delivered within ~10s                               | `[ ]`  |
| 1.2.2 | Long response (>4096 chars)      | Ask for a detailed explanation      | Response split into multiple Telegram messages (chunking) | `[ ]`  |
| 1.2.3 | Markdown in response             | Ask Claude to format with markdown  | Telegram renders markdown (bold, italic, code blocks)     | `[ ]`  |
| 1.2.4 | Code blocks in response          | Ask "Write a hello world in Python" | Code block rendered properly, not split mid-block         | `[ ]`  |
| 1.2.5 | Response with special characters | Ask for text with `< > & " '`       | Characters rendered correctly, not escaped/broken         | `[ ]`  |

### 1.3 Response timing

| #     | Scenario                    | Steps                                     | Expected                                                       | Status |
| ----- | --------------------------- | ----------------------------------------- | -------------------------------------------------------------- | ------ |
| 1.3.1 | Typing indicator appears    | Send message, observe Telegram            | "typing..." appears while Claude processes                     | `[ ]`  |
| 1.3.2 | Typing indicator disappears | Wait for response                         | Typing stops when response arrives                             | `[ ]`  |
| 1.3.3 | Typing TTL (2 min)          | Ask something that takes >2 min           | Typing stops at 2 min, response still arrives later (or error) | `[ ]`  |
| 1.3.4 | Reply timeout               | Ask something Claude can't answer in time | Error message delivered after OCC_REPLY_TIMEOUT_MS             | `[ ]`  |

---

## 2. Claude Code Tool Execution (P0)

### 2.1 Bash commands

| #     | Scenario                        | Steps                                   | Expected                                                   | Status |
| ----- | ------------------------------- | --------------------------------------- | ---------------------------------------------------------- | ------ |
| 2.1.1 | Simple command                  | "Run `ls -la` in the project directory" | Claude executes ls, includes output in reply               | `[x]`  |
| 2.1.2 | Package install                 | "Install cowsay with npm globally"      | Claude runs npm install, reports success                   | `[ ]`  |
| 2.1.3 | Git operations                  | "What is the current git branch?"       | Claude runs git branch, reports result                     | `[ ]`  |
| 2.1.4 | Command with long output        | "Show the contents of package.json"     | Full file contents included (possibly truncated by Claude) | `[ ]`  |
| 2.1.5 | Failing command                 | "Run `cat nonexistent_file`"            | Claude reports the error, does not crash                   | `[ ]`  |
| 2.1.6 | No permission prompt (headless) | Any command                             | Executes without prompting — auto-approve hook works       | `[x]`  |

### 2.2 File operations

| #     | Scenario         | Steps                                        | Expected                                               | Status |
| ----- | ---------------- | -------------------------------------------- | ------------------------------------------------------ | ------ |
| 2.2.1 | Create file      | "Create a file called test.txt with 'hello'" | File created on disk                                   | `[x]`  |
| 2.2.2 | Edit file        | "Add a line to test.txt"                     | File modified                                          | `[ ]`  |
| 2.2.3 | Read file        | "What's in test.txt?"                        | Contents reported                                      | `[ ]`  |
| 2.2.4 | Edit ~/CLAUDE.md | "Add '# Test' to ~/CLAUDE.md"                | File created/edited without prompts                    | `[ ]`  |
| 2.2.5 | Create skill     | "Create .claude/skills/hello/SKILL.md"       | Skill file created without prompts (auto-approve hook) | `[x]`  |

---

## 3. Proactive Messaging (P1)

### 3.1 notify tool

| #     | Scenario                              | Steps                                              | Expected                                    | Status |
| ----- | ------------------------------------- | -------------------------------------------------- | ------------------------------------------- | ------ |
| 3.1.1 | Proactive message to Telegram         | Claude uses `notify(telegram, <chatId>, "Alert!")` | Message arrives in Telegram chat            | `[ ]`  |
| 3.1.2 | notify without OPENCLAW_GATEWAY_TOKEN | Unset token, try notify                            | Error: "Proactive messaging not configured" | `[ ]`  |
| 3.1.3 | notify to invalid channel             | `notify("nonexistent", "123", "test")`             | Error from OpenClaw API, surfaced to Claude | `[ ]`  |
| 3.1.4 | notify to invalid recipient           | `notify("telegram", "000", "test")`                | Error or silent failure from Telegram API   | `[ ]`  |

### 3.2 send_file tool

| #     | Scenario                      | Steps                                     | Expected                                                           | Status |
| ----- | ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------ | ------ |
| 3.2.1 | Send text file                | "Send the contents of package.json to me" | File content arrives as text message                               | `[ ]`  |
| 3.2.2 | Send large file (>4000 chars) | File with 10k chars                       | Truncated, with "[truncated, showing first 4000 of N chars]" note  | `[ ]`  |
| 3.2.3 | Send file >1MB                | Create 2MB file, try to send              | Error: "File too large"                                            | `[ ]`  |
| 3.2.4 | Send binary file              | Try to send an image or binary            | Error: "Binary files are not supported"                            | `[ ]`  |
| 3.2.5 | Path traversal attempt        | "Send /etc/passwd"                        | Error: "filePath must be within the project directory"             | `[ ]`  |
| 3.2.6 | Symlink escape                | Create symlink to /etc/hosts, try to send | Error: "filePath resolves outside the project directory (symlink)" | `[ ]`  |
| 3.2.7 | Relative path traversal       | "Send ../../etc/passwd"                   | Error: path traversal rejected                                     | `[ ]`  |
| 3.2.8 | Nonexistent file              | "Send nonexistent.txt"                    | Error: "File not found"                                            | `[ ]`  |

---

## 4. OpenClaw Scheduling (P1)

### 4.1 Cron jobs

| #     | Scenario                        | Steps                                                                 | Expected                                             | Status |
| ----- | ------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- | ------ |
| 4.1.1 | Create cron job                 | `openclaw cron add --schedule "*/5 * * * *" --message "Check status"` | Job created, fires every 5 min                       | `[ ]`  |
| 4.1.2 | Cron triggers Claude Code       | Wait for cron fire                                                    | Claude Code receives the message, processes, replies | `[ ]`  |
| 4.1.3 | Cron response delivered         | After cron processing                                                 | Response appears in Telegram                         | `[ ]`  |
| 4.1.4 | Cron during active conversation | User chatting + cron fires                                            | Cron queued until active request completes           | `[ ]`  |
| 4.1.5 | Delete cron job                 | `openclaw cron remove <id>`                                           | Job removed, no more triggers                        | `[ ]`  |

### 4.2 Heartbeat

| #     | Scenario                         | Steps                          | Expected                              | Status |
| ----- | -------------------------------- | ------------------------------ | ------------------------------------- | ------ |
| 4.2.1 | Heartbeat fires                  | Wait for heartbeat interval    | Claude Code receives heartbeat prompt | `[ ]`  |
| 4.2.2 | Heartbeat with nothing to report | Claude replies HEARTBEAT_OK    | No message delivered to user          | `[ ]`  |
| 4.2.3 | Heartbeat with update            | Claude has something to report | Update delivered to user in Telegram  | `[ ]`  |

---

## 5. OpenClaw Media Handling (P2)

### 5.1 Inbound media

| #     | Scenario          | Steps                    | Expected                                                                           | Status |
| ----- | ----------------- | ------------------------ | ---------------------------------------------------------------------------------- | ------ |
| 5.1.1 | Photo             | Send a photo to bot      | Behavior documented: image blocks filtered, text description may or may not arrive | `[ ]`  |
| 5.1.2 | Document (text)   | Send a .txt file         | Content extracted and forwarded to Claude                                          | `[ ]`  |
| 5.1.3 | Document (PDF)    | Send a PDF               | Behavior depends on OpenClaw PDF handling                                          | `[ ]`  |
| 5.1.4 | Voice note        | Send a voice message     | NOT transcribed (known OpenClaw limitation). Placeholder text arrives              | `[ ]`  |
| 5.1.5 | Sticker           | Send a sticker           | Static: vision-analyzed description. Animated: skipped                             | `[ ]`  |
| 5.1.6 | Video             | Send a video             | Likely dropped or placeholder                                                      | `[ ]`  |
| 5.1.7 | Location          | Share location           | Behavior unknown — document result                                                 | `[ ]`  |
| 5.1.8 | Contact           | Share a contact          | Behavior unknown — document result                                                 | `[ ]`  |
| 5.1.9 | Forwarded message | Forward a message to bot | Original text arrives, forward metadata likely lost                                | `[ ]`  |

### 5.2 Content format handling

| #     | Scenario                 | Steps                                                                            | Expected                                                      | Status |
| ----- | ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| 5.2.1 | Multimodal content array | OpenClaw sends `content: [{type: "text", text: "hi"}, {type: "image_url", ...}]` | extractText returns only text parts, images silently filtered | `[ ]`  |
| 5.2.2 | Image-only message       | Send only a photo, no caption                                                    | OCC returns 400 "No user message found" (no text to extract)  | `[ ]`  |

---

## 6. OpenClaw Session Management (P2)

### 6.1 Session continuity

| #     | Scenario                     | Steps                                                         | Expected                                                                 | Status |
| ----- | ---------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| 6.1.1 | Multi-turn conversation      | Send 5 sequential messages                                    | Claude Code sees conversation context (up to 3 preceding messages)       | `[ ]`  |
| 6.1.2 | Context after session reset  | Wait for daily reset (or trigger manually), then send message | Fresh context, no previous history                                       | `[ ]`  |
| 6.1.3 | Long conversation compaction | Send 50+ messages in one session                              | OpenClaw compacts older messages. Claude Code receives compacted summary | `[ ]`  |

### 6.2 Session isolation

| #     | Scenario                           | Steps                                | Expected                                   | Status |
| ----- | ---------------------------------- | ------------------------------------ | ------------------------------------------ | ------ |
| 6.2.1 | DM session                         | Message bot in DM                    | Processed normally                         | `[ ]`  |
| 6.2.2 | Group session (if configured)      | Message bot in group with @mention   | Processed in separate group session        | `[ ]`  |
| 6.2.3 | Two users messaging simultaneously | Two users send messages at same time | Processed sequentially (OCC serialization) | `[ ]`  |

---

## 7. OpenClaw Security (P1)

### 7.1 Pairing

| #     | Scenario                    | Steps                                      | Expected                                               | Status |
| ----- | --------------------------- | ------------------------------------------ | ------------------------------------------------------ | ------ |
| 7.1.1 | Unpaired user sends message | New user messages bot                      | Receives pairing code, message NOT forwarded to Claude | `[ ]`  |
| 7.1.2 | Approve pairing             | `openclaw pairing approve telegram <code>` | User added to allowlist, subsequent messages processed | `[ ]`  |
| 7.1.3 | Reject pairing              | Ignore the code                            | User remains blocked                                   | `[ ]`  |

### 7.2 Access control

| #     | Scenario              | Steps                              | Expected                 | Status |
| ----- | --------------------- | ---------------------------------- | ------------------------ | ------ |
| 7.2.1 | Allowed user          | Paired user sends message          | Processed normally       | `[ ]`  |
| 7.2.2 | Blocked user in group | Non-allowed user messages in group | Message silently dropped | `[ ]`  |
| 7.2.3 | DM policy disabled    | Set `dmPolicy: "disabled"`         | All DMs rejected         | `[ ]`  |

### 7.3 OCC authentication

| #     | Scenario                     | Steps                               | Expected          | Status |
| ----- | ---------------------------- | ----------------------------------- | ----------------- | ------ |
| 7.3.1 | Valid API token              | OpenClaw sends correct Bearer token | Request processed | `[ ]`  |
| 7.3.2 | Invalid API token            | curl with wrong token               | 401 Unauthorized  | `[x]`  |
| 7.3.3 | Missing Authorization header | curl without auth                   | 401 Unauthorized  | `[x]`  |

---

## 8. Error Handling and Recovery (P1)

### 8.1 OCC errors

| #     | Scenario                        | Steps                                     | Expected                                               | Status |
| ----- | ------------------------------- | ----------------------------------------- | ------------------------------------------------------ | ------ |
| 8.1.1 | OCC not running                 | Stop OCC, send message                    | OpenClaw returns connection error to user              | `[ ]`  |
| 8.1.2 | OCC restart during conversation | Kill and restart Claude Code + OCC        | Previous request lost. New messages work after restart | `[ ]`  |
| 8.1.3 | OCC reply timeout               | Claude Code hangs (e.g., infinite loop)   | Error after OCC_REPLY_TIMEOUT_MS, user notified        | `[ ]`  |
| 8.1.4 | Malformed request to OCC        | Send invalid JSON to /v1/chat/completions | 400 error response                                     | `[x]`  |
| 8.1.5 | Missing messages field          | Send `{"model": "test"}`                  | 400 error response                                     | `[x]`  |
| 8.1.6 | Invalid message roles           | Send messages with `role: "admin"`        | 400 error response                                     | `[ ]`  |

### 8.2 OpenClaw errors

| #     | Scenario                      | Steps                     | Expected                                             | Status |
| ----- | ----------------------------- | ------------------------- | ---------------------------------------------------- | ------ |
| 8.2.1 | OpenClaw Gateway restart      | Restart gateway container | Bot reconnects, messages resume                      | `[ ]`  |
| 8.2.2 | Telegram polling interruption | Network hiccup            | Bot resumes polling, may miss messages during outage | `[ ]`  |
| 8.2.3 | Rate limiting from Telegram   | Rapid message sending     | OpenClaw handles Telegram 429 responses              | `[ ]`  |

### 8.3 Claude Code errors

| #     | Scenario                     | Steps                                     | Expected                                         | Status |
| ----- | ---------------------------- | ----------------------------------------- | ------------------------------------------------ | ------ |
| 8.3.1 | Claude Code rate limited     | Exceed Pro plan limits                    | Error returned to user via OCC/OpenClaw          | `[ ]`  |
| 8.3.2 | Claude Code context overflow | Very long conversation within one session | Claude Code compacts or errors                   | `[ ]`  |
| 8.3.3 | MCP connection drop          | Kill Claude Code process                  | OCC process dies, OpenClaw gets connection error | `[ ]`  |

---

## 9. Auto-Approve Hooks (P0)

### 9.1 PreToolUse hook

| #     | Scenario                   | Steps                             | Expected                | Status |
| ----- | -------------------------- | --------------------------------- | ----------------------- | ------ |
| 9.1.1 | Bash command auto-approved | Ask Claude to run a shell command | Executes without prompt | `[x]`  |
| 9.1.2 | File write auto-approved   | Ask Claude to create a file       | Created without prompt  | `[ ]`  |
| 9.1.3 | Web fetch auto-approved    | Ask Claude to fetch a URL         | Fetched without prompt  | `[ ]`  |

### 9.2 PermissionRequest hook

| #     | Scenario                 | Steps                              | Expected                                          | Status |
| ----- | ------------------------ | ---------------------------------- | ------------------------------------------------- | ------ |
| 9.2.1 | .claude/ directory write | Create a skill file                | Created without prompt (hook bypasses protection) | `[x]`  |
| 9.2.2 | mkdir in .claude/        | Ask to create .claude/skills/test/ | Created without prompt                            | `[x]`  |

### 9.3 Without hooks (control test)

| #     | Scenario                     | Steps                            | Expected                               | Status |
| ----- | ---------------------------- | -------------------------------- | -------------------------------------- | ------ |
| 9.3.1 | Bash without hooks           | Remove hooks, ask for command    | Blocks on permission prompt, times out | `[ ]`  |
| 9.3.2 | .claude/ write without hooks | Remove hooks, try skill creation | Blocks on permission prompt            | `[ ]`  |

---

## 10. HTTP API Conformance (P2)

### 10.1 /v1/chat/completions

| #      | Scenario               | Steps                                      | Expected                                                                          | Status |
| ------ | ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- | ------ |
| 10.1.1 | Non-streaming response | `stream: false`                            | JSON response with `choices[].message.content`                                    | `[x]`  |
| 10.1.2 | Streaming response     | `stream: true`                             | SSE stream with `data:` lines and `[DONE]`                                        | `[ ]`  |
| 10.1.3 | Missing stream field   | Omit `stream`                              | Non-streaming response (default)                                                  | `[ ]`  |
| 10.1.4 | String content         | `content: "hello"`                         | Processed as text                                                                 | `[ ]`  |
| 10.1.5 | Array content          | `content: [{type: "text", text: "hello"}]` | Processed as text                                                                 | `[ ]`  |
| 10.1.6 | System + user messages | Full conversation with system prompt       | System prompt excluded from Claude Code notification. Only user message forwarded | `[ ]`  |

### 10.2 /v1/models

| #      | Scenario    | Steps          | Expected                                                        | Status |
| ------ | ----------- | -------------- | --------------------------------------------------------------- | ------ |
| 10.2.1 | List models | GET /v1/models | Returns `claude-code` with context_window and max_output_tokens | `[x]`  |

### 10.3 /health

| #      | Scenario     | Steps        | Expected                         | Status |
| ------ | ------------ | ------------ | -------------------------------- | ------ |
| 10.3.1 | GET /health  | curl         | `{"ok": true, "version": "..."}` | `[x]`  |
| 10.3.2 | GET /healthz | curl         | Same response                    | `[x]`  |
| 10.3.3 | POST /health | curl -X POST | 404 (method not allowed)         | `[x]`  |

---

## 11. Context and History (P2)

### 11.1 Context forwarding

| #      | Scenario                         | Steps                            | Expected                                                                  | Status |
| ------ | -------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | ------ |
| 11.1.1 | Channel metadata in notification | Send from Telegram               | Notification meta includes `channel: "telegram"`                          | `[ ]`  |
| 11.1.2 | History included                 | Send 3+ messages in conversation | Claude sees "Conversation context" with preceding messages                | `[ ]`  |
| 11.1.3 | History truncated to 3           | Send 10 messages                 | Only last 3 preceding messages shown, with "[N earlier messages omitted]" | `[ ]`  |
| 11.1.4 | System prompt summary            | OpenClaw includes system prompt  | First 500 chars forwarded as `[Agent context: ...]`                       | `[x]`  |
| 11.1.5 | Trailing assistant excluded      | Messages after last user message | NOT included in history                                                   | `[ ]`  |
| 11.1.6 | Image URL forwarded              | Send photo with caption          | Claude sees `[Image: <url>]` in notification                              | `[ ]`  |
| 11.1.7 | Multiple images                  | Send message with 2+ images      | All image URLs listed as separate `[Image: ...]` lines                    | `[ ]`  |
| 11.1.8 | Whitespace-only system prompt    | System prompt is spaces only     | No `[Agent context: ...]` line (trimmed to empty)                         | `[ ]`  |

### 11.2 Streaming behavior (P2)

| #      | Scenario                     | Steps                                | Expected                                | Status |
| ------ | ---------------------------- | ------------------------------------ | --------------------------------------- | ------ |
| 11.2.1 | Response chunked for display | Ask a question, observe Telegram     | Text appears gradually, not all at once | `[ ]`  |
| 11.2.2 | Chunk boundary at word       | Response with spaces every ~50 chars | No extra spaces in delivered text       | `[ ]`  |
| 11.2.3 | Long word (URL) hard-split   | Response contains 100-char URL       | URL split at 50 chars, no data loss     | `[ ]`  |
| 11.2.4 | Short response single chunk  | Response < 50 chars                  | Delivered as single chunk               | `[ ]`  |

### 11.3 Delivery confirmation (P2)

| #      | Scenario                      | Steps                      | Expected                                            | Status |
| ------ | ----------------------------- | -------------------------- | --------------------------------------------------- | ------ |
| 11.3.1 | notify returns message ID     | Claude uses notify tool    | Tool reports "Sent to telegram:123 (id: <id>)"      | `[ ]`  |
| 11.3.2 | notify without ID in response | OpenClaw returns no ID     | Tool reports "Sent to telegram:123"                 | `[ ]`  |
| 11.3.3 | send_file returns message ID  | Claude uses send_file tool | Tool reports "File sent to telegram:123 (id: <id>)" | `[ ]`  |

### 11.4 File code fences (P2)

| #      | Scenario               | Steps                       | Expected                                                    | Status |
| ------ | ---------------------- | --------------------------- | ----------------------------------------------------------- | ------ |
| 11.4.1 | TypeScript file        | Send .ts file via send_file | Wrapped in ` ```ts ` code fence                             | `[ ]`  |
| 11.4.2 | Python file            | Send .py file via send_file | Wrapped in ` ```py ` code fence                             | `[ ]`  |
| 11.4.3 | File without extension | Send Makefile via send_file | Wrapped in ` ```text ` code fence (default)                 | `[ ]`  |
| 11.4.4 | Large file truncated   | Send file > 8000 chars      | Truncated with "[truncated, showing first 8000 of N chars]" | `[ ]`  |

---

## 12. Concurrent and Stress Scenarios (P2)

| #    | Scenario                           | Steps                                                     | Expected                                                                  | Status |
| ---- | ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| 12.1 | Rapid fire messages                | Send 5 messages in 2 seconds                              | Processed sequentially, all get responses                                 | `[ ]`  |
| 12.2 | Message during long processing     | Claude is executing multi-step task, send another message | Second message queued, processed after first completes                    | `[ ]`  |
| 12.3 | Cron + user message simultaneously | Cron fires while user is chatting                         | Serialized, one at a time                                                 | `[ ]`  |
| 12.4 | OCC uptime 24h                     | Run for 24 hours                                          | No memory leaks, no degradation                                           | `[ ]`  |
| 12.5 | 100+ messages in one session       | Send many messages over hours                             | OpenClaw compacts history, Claude Code compacts separately. System stable | `[ ]`  |

---

## 13. Known Limitations (document, don't fix)

| #     | Limitation                             | Expected behavior                                                                                            |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 13.1  | ~~Images not forwarded~~ FIXED         | Image URLs now forwarded as `[Image: <url>]` in notifications. Claude can't view images but knows they exist |
| 13.2  | Voice not transcribed                  | Voice messages arrive as placeholder text, not transcription (OpenClaw limitation)                           |
| 13.3  | No reactions from Claude               | Claude cannot send emoji reactions (tool calling not forwarded to custom providers)                          |
| 13.4  | No message editing                     | Claude cannot edit previously sent messages                                                                  |
| 13.5  | No inline keyboards                    | Claude cannot create Telegram inline keyboards                                                               |
| 13.6  | No threading                           | Claude cannot reply to specific messages in a thread                                                         |
| 13.7  | ~~No file attachments~~ IMPROVED       | `send_file` wraps content in code fences with syntax highlighting. Still text, not binary attachment         |
| 13.8  | ~~Single-chunk streaming~~ FIXED       | Response now split into ~50-char word-boundary chunks for gradual delivery                                   |
| 13.9  | ~~Skills not visible~~ PARTIALLY FIXED | System prompt summary (first 500 chars) forwarded as `[Agent context: ...]`                                  |
| 13.10 | ~~Memory not visible~~ PARTIALLY FIXED | System prompt (which includes memory) summary forwarded. Full SOUL.md/MEMORY.md still not available          |
| 13.11 | Sequential only                        | One request at a time per OCC instance                                                                       |
| 13.12 | ~~No delivery confirmation~~ FIXED     | `notify`/`send_file` tools return message ID from OpenClaw API when available                                |
| 13.13 | Claude Code rate limits                | Pro: ~10-40 prompts/5h. Max 5x: ~88K tokens. Each message = 1+ prompts                                       |
| 13.14 | Session not resumable                  | If Claude Code process dies, session context is lost. No auto-restart                                        |

---

## 14. Setup Verification Checklist (P0)

Run before testing any other scenarios.

| #    | Check                        | Command/Action                                                         | Expected                                                               | Status |
| ---- | ---------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------ |
| 14.1 | OpenClaw healthy             | `curl http://127.0.0.1:18789/healthz`                                  | `{"ok":true}`                                                          | `[x]`  |
| 14.2 | OCC healthy                  | `curl http://127.0.0.1:3456/health`                                    | `{"ok":true, "version":"..."}`                                         | `[x]`  |
| 14.3 | OCC reachable from OpenClaw  | `docker exec <container> curl http://host.docker.internal:3456/health` | `{"ok":true}`                                                          | `[x]`  |
| 14.4 | Telegram bot connected       | `openclaw channels status`                                             | `telegram default: enabled, running`                                   | `[x]`  |
| 14.5 | Agent model correct          | Check gateway logs                                                     | `agent model: occ/claude-code`                                         | `[x]`  |
| 14.6 | Claude Code listening        | Check tmux session                                                     | `Listening for channel messages from: server:occ`                      | `[ ]`  |
| 14.7 | Auto-approve hooks installed | `.claude/hooks/auto-approve.sh` exists and executable                  | `echo test \| .claude/hooks/auto-approve.sh` returns JSON with `allow` | `[x]`  |
| 14.8 | Telegram pairing approved    | Send message from approved user                                        | Response received, not pairing code                                    | `[ ]`  |
