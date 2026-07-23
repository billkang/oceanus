#!/bin/bash
# reef-protect-files.sh
# PreToolUse: 保护敏感文件不被修改

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""') || exit 0

[ -z "$FILE_PATH" ] && exit 0

FILENAME=$(basename "$FILE_PATH")

PROTECTED_PATTERNS=(
  ".env"
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
)

PROTECTED_DIRS=(
  ".git/"
  "node_modules/"
)

for dir in "${PROTECTED_DIRS[@]}"; do
  if [[ "$FILE_PATH" == *"$dir"* ]]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot modify files in protected directory: $dir"
  }
}
EOF
    exit 0
  fi
done

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILENAME" == "$pattern" ]]; then
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Cannot modify protected file: $pattern"
  }
}
EOF
    exit 0
  fi
done

# 默认放行
exit 0
