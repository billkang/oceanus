#!/bin/bash
# tide-session-preload.sh
# sessionStart hook for tide-discuss.
# Reads tide-data/sessions/.index.json and injects session summaries
# into the AI system context as TIDE_SESSIONS:N header + JSON lines.
# Falls back silently if .index.json doesn't exist.
# 使用 jq 替代 python3（避免 Python 进程启动开销）

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
INDEX_FILE="${PROJECT_DIR}/tide-data/sessions/.index.json"

[ ! -f "$INDEX_FILE" ] && exit 0

jq -r '
  "TIDE_SESSIONS:\(length)",
  (.[] | {sessionId, status, brief, createdAt, featureId} | tojson)
' "$INDEX_FILE" 2>/dev/null || true
