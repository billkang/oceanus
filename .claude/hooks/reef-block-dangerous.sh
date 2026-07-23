#!/bin/bash
# reef-block-dangerous.sh
# PreToolUse: 拦截危险的 Bash 命令

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""') || exit 0

[ -z "$COMMAND" ] && exit 0

DANGEROUS_PATTERNS=(
  "rm -rf /"
  "rm -rf ~"
  "rm -rf \$HOME"
  "rm -rf /*"
  "> /dev/sd"
  "mkfs."
  "dd if="
  ":(){:|:&};:"
  "chmod -R 777 /"
  "chown -R"
  "git push --force origin main"
  "git push --force origin master"
  "git reset --hard origin"
)

# sed -i 修改敏感文件（.env、lock 文件等）
if echo "$COMMAND" | grep -qE "sed\s+-i.*\.env|sed\s+-i.*lock\.json|sed\s+-i.*lock\.yaml"; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked: sed -i on protected file (.env or lock file)"
  }
}
EOF
  exit 0
fi

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if [[ "$COMMAND" == *"$pattern"* ]]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked dangerous command pattern: $pattern"
  }
}
EOF
    exit 0
  fi
done

# regex: curl/wget 管道到 sh/bash
if echo "$COMMAND" | grep -qE '(curl|wget)\s+\S.*\|\s*(sh|bash)\b'; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked dangerous command: pipe from curl/wget to shell"
  }
}
EOF
  exit 0
fi

# 默认放行
exit 0
