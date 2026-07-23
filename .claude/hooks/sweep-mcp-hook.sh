#!/bin/bash
# MCP Hook for Claude Code — auto-start Playwright MCP on session start
# Usage:
#   ./scripts/mcp-hook.sh              # start in headless mode (default)
#   ./scripts/mcp-hook.sh --headed     # start with visible browser
#   ./scripts/mcp-hook.sh --stop       # stop MCP
#   ./scripts/mcp-hook.sh --status     # check status

MCP_PORT=54321
BIN="node_modules/.bin/playwright-mcp"

case "${1:-}" in
  --stop)
    PID=$(lsof -ti tcp:$MCP_PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      kill -9 "$PID" 2>/dev/null
      echo "mcp: stopped (PID $PID)"
    else
      echo "mcp: not running"
    fi
    exit 0
    ;;
  --status)
    PID=$(lsof -ti tcp:$MCP_PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      CMD=$(ps -p "$PID" -o args= 2>/dev/null)
      if echo "$CMD" | grep -q -- "--headless"; then
        MODE="headless"
      else
        MODE="headed"
      fi
      echo "mcp: running (PID $PID, mode: $MODE)"
    else
      echo "mcp: not running"
    fi
    exit 0
    ;;
  --headed)
    MODE_FLAG=""
    ;;
  *)
    MODE_FLAG="--headless"
    ;;
esac

PID=$(lsof -ti tcp:$MCP_PORT 2>/dev/null)
if [ -n "$PID" ]; then
  CMD=$(ps -p "$PID" -o args= 2>/dev/null)
  if echo "$CMD" | grep -q -- "--headless"; then
    CURRENT="headless"
  else
    CURRENT="headed"
  fi
  DESIRED="${MODE_FLAG:+headless}"
  DESIRED="${DESIRED:-headed}"
  if [ "$CURRENT" = "$DESIRED" ]; then
    echo "mcp: already running ($CURRENT mode, PID $PID)"
    exit 0
  fi
  kill -9 "$PID" 2>/dev/null
  sleep 1
fi

if [ -x "$BIN" ]; then
  nohup "$BIN" --port "$MCP_PORT" $MODE_FLAG --isolated > /tmp/playwright-mcp.log 2>&1 &
else
  nohup npx @playwright/mcp --port "$MCP_PORT" $MODE_FLAG > /tmp/playwright-mcp.log 2>&1 &
fi

sleep 2
NEW_PID=$(lsof -ti tcp:$MCP_PORT 2>/dev/null)
if [ -n "$NEW_PID" ]; then
  echo "mcp: started (PID $NEW_PID, mode: ${MODE_FLAG:-headed})"
else
  echo "mcp: failed to start — see /tmp/playwright-mcp.log"
  exit 1
fi
