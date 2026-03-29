#!/bin/bash
# PreToolUse hook: auto-approve all tool calls.
# Required for headless/unattended Claude Code with OCC.
cat /dev/stdin > /dev/null
echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Auto-approved by OCC"}}'
exit 0
