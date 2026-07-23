#!/bin/bash
# run-tests.sh
# 根据项目类型自动检测并运行测试。
#
# 用法:
#   bash run-tests.sh              # 自动检测并运行
#   bash run-tests.sh --json       # JSON 格式输出结果
#   bash run-tests.sh --help       # 显示帮助

set -euo pipefail

MODE="text"
for arg in "$@"; do
  case "$arg" in
    --json) MODE="json" ;;
    --help|-h)
      echo "用法: bash run-tests.sh [--json]"
      echo "自动检测项目类型（Java/Python/Frontend）并运行测试"
      exit 0
      ;;
  esac
done

FRONTEND_FAILED=false
BACKEND_FAILED=false
HAS_FRONTEND=false
HAS_BACKEND=false

# 检测后端
if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  HAS_BACKEND=true
  echo "🔍 检测到 Gradle 项目，运行 ./gradlew test..."
  if ./gradlew test 2>&1; then
    echo "✅ Java 测试通过"
  else
    BACKEND_FAILED=true
    echo "❌ Java 测试失败"
  fi
elif [ -f "pom.xml" ]; then
  HAS_BACKEND=true
  echo "🔍 检测到 Maven 项目，运行 mvn test..."
  if mvn test 2>&1; then
    echo "✅ Java 测试通过"
  else
    BACKEND_FAILED=true
    echo "❌ Java 测试失败"
  fi
elif [ -f "pyproject.toml" ] || [ -f "pytest.ini" ]; then
  HAS_BACKEND=true
  echo "🔍 检测到 Python 项目，运行 pytest..."
  if python -m pytest 2>&1; then
    echo "✅ Python 测试通过"
  else
    BACKEND_FAILED=true
    echo "❌ Python 测试失败"
  fi
fi

# 检测前端
if [ -f "package.json" ]; then
  HAS_FRONTEND=true
  echo "🔍 检测到前端项目，运行 pnpm test..."
  if pnpm test -- --run 2>&1; then
    echo "✅ 前端测试通过"
  else
    FRONTEND_FAILED=true
    echo "❌ 前端测试失败"
  fi
fi

if [ "$HAS_BACKEND" = false ] && [ "$HAS_FRONTEND" = false ]; then
  echo "⚠️  未检测到可运行的测试项目"
fi

# JSON 输出
if [ "$MODE" = "json" ]; then
  cat <<EOF
{
  "hasFrontend": $HAS_FRONTEND,
  "hasBackend": $HAS_BACKEND,
  "frontendPassed": $( [ "$FRONTEND_FAILED" = false ] && echo "$HAS_FRONTEND" || echo false ),
  "backendPassed": $( [ "$BACKEND_FAILED" = false ] && echo "$HAS_BACKEND" || echo false ),
  "allPassed": $( [ "$FRONTEND_FAILED" = false ] && [ "$BACKEND_FAILED" = false ] && echo true || echo false )
}
EOF
fi

# exit code
if [ "$FRONTEND_FAILED" = true ] || [ "$BACKEND_FAILED" = true ]; then
  exit 1
fi
