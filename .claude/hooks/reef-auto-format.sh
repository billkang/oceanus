#!/bin/bash
# reef-auto-format.sh
# PostToolUse: 在 Edit/Write 后自动格式化代码
#
# 从 stdin JSON 解析文件路径（标准 Claude Code hook 协议），
# 同时支持 $CLAUDE_CODE_TOOL_RESULT_FILEPATH 环境变量作为降级。
#
# 性能优先：单文件格式化 > 全项目格式化
#   Java:   按 reef code-style 人工控制，不自动格式化
#   Python: ruff format > black
#   TS/JS:  eslint --fix

set -euo pipefail

# ── 1. 获取文件路径 ──────────────────────────────────────────────────
# 优先从 stdin JSON 解析（PostToolUse 标准协议），降级到环境变量
filepath=""

# 尝试从 stdin 读取（PostToolUse hook JSON）
if [ -p /dev/stdin ] && command -v jq &>/dev/null; then
  filepath=$(jq -r '.tool_response.filePath // .tool_input.file_path // ""' 2>/dev/null || true)
fi

# 降级：环境变量
if [ -z "$filepath" ] || [ "$filepath" = "null" ]; then
  filepath="${CLAUDE_CODE_TOOL_RESULT_FILEPATH:-}"
fi

# 仍然拿不到路径，退出
[ -z "$filepath" ] && exit 0
[ ! -f "$filepath" ] && exit 0

# 检测项目根目录
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# ── 2. 按文件类型执行格式化 ──────────────────────────────────────────

case "$filepath" in
  *.java)
    # Java: 按 reef code-style 人工控制，不执行自动格式化
    : # no-op
    ;;
  *.py)
    if command -v ruff &>/dev/null; then
      ruff format "$filepath"
    elif command -v black &>/dev/null; then
      black "$filepath"
    fi
    ;;
  *.ts|*.tsx|*.html|*.css|*.scss|*.less|*.json|*.yaml|*.yml)
    if ! command -v npx &>/dev/null; then
      exit 0
    fi
    remaining=$(cd "$PROJECT_DIR" && npx eslint --fix "$filepath" 2>/dev/null || true)
    if [ -n "$remaining" ]; then
      echo "[auto-format] ⚠ 以下 ESLint 错误需要手动修复："
      echo "$remaining"
      echo "[auto-format] 请运行  lint 查看完整报告。"
    fi
    ;;
  *.go)
    command -v gofmt &>/dev/null && gofmt -w "$filepath"
    ;;
  *.rs)
    command -v rustfmt &>/dev/null && rustfmt "$filepath"
    ;;
  *.sql)
    # 如果项目配置了 SQL 格式化工具，在此扩展
    ;;
esac

exit 0
