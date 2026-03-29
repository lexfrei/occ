#!/bin/bash
# PermissionRequest hook: auto-approve all permission dialogs.
# Bypasses .claude/ directory protection for skill/agent creation.
cat /dev/stdin > /dev/null
echo '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
exit 0
