#!/bin/bash
# reef-run-tests.sh
# Stop hook: 停止前运行测试，超时后放行
# 使用 timeout 避免长时间阻塞退出流程；无 timeout 命令时回退为普通运行

export PATH="$HOME/bin:/usr/local/bin:$PATH"

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd "$(dirname "$0")/../.." 2>/dev/null || true

TIMEOUT=30
FRONTEND_FAILED=false
BACKEND_FAILED=false

# timeout 命令兼容（macOS: gtimeout, Linux: timeout）
if command -v gtimeout &>/dev/null; then
  TIMEOUT_CMD="gtimeout $TIMEOUT"
elif command -v timeout &>/dev/null; then
  TIMEOUT_CMD="timeout $TIMEOUT"
fi

# Python 测试（pytest）
if [ -f "pyproject.toml" ] || [ -f "pytest.ini" ] || [ -f "setup.cfg" ]; then
  if ! command -v pytest &>/dev/null && ! python -m pytest --version &>/dev/null 2>&1; then
    exit 0
  fi
  echo "Running Python tests (python -m pytest, timeout ${TIMEOUT}s)..." >&2
  if $TIMEOUT_CMD python -m pytest 2>&1; then
    echo "Python tests passed." >&2
  else
    rc=$?
    if [ -n "$TIMEOUT_CMD" ] && [ $rc -eq 124 ]; then
      echo "[reef-run-tests] ⏱ Python tests timed out after ${TIMEOUT}s, continuing..." >&2
    else
      BACKEND_FAILED=true
      echo "Python tests FAILED." >&2
    fi
  fi
fi

# 前端测试（pnpm）
if [ -f "package.json" ]; then
  echo "Running frontend tests (pnpm test, timeout ${TIMEOUT}s)..." >&2
  if $TIMEOUT_CMD pnpm test 2>&1; then
    echo "Frontend tests passed." >&2
  else
    rc=$?
    if [ -n "$TIMEOUT_CMD" ] && [ $rc -eq 124 ]; then
      echo "[reef-run-tests] ⏱ Frontend tests timed out after ${TIMEOUT}s, continuing..." >&2
    else
      FRONTEND_FAILED=true
      echo "Frontend tests FAILED." >&2
    fi
  fi
fi

# 后端测试（Gradle）
if [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "Running backend tests (./gradlew test, timeout ${TIMEOUT}s)..." >&2
  if $TIMEOUT_CMD ./gradlew test 2>&1; then
    echo "Backend tests passed." >&2
  else
    rc=$?
    if [ -n "$TIMEOUT_CMD" ] && [ $rc -eq 124 ]; then
      echo "[reef-run-tests] ⏱ Backend tests timed out after ${TIMEOUT}s, continuing..." >&2
    else
      BACKEND_FAILED=true
      echo "Backend tests FAILED." >&2
    fi
  fi
fi

if [ "$FRONTEND_FAILED" = false ] && [ "$BACKEND_FAILED" = false ]; then
  echo '{"decision": "approve", "reason": "All tests passed."}'
  exit 0
else
  cat <<EOF
{
  "decision": "block",
  "reason": "Tests are failing. Please fix the issues before stopping.",
  "continue": true
}
EOF
  exit 0
fi
