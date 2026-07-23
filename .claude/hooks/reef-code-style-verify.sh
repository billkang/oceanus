#!/bin/bash
# reef-code-style-verify.sh.tmpl
# PostToolUse: 在 Edit/Write 后自动验证代码风格
#
# 模板变量（安装时由 wizard 注入）：
#       — Java lint 命令（默认 checkstyle）
#     — Python lint 命令（默认 ruff check）
#           — 前端 lint 命令（默认 eslint）

set -euo pipefail

# ── 1. 获取文件路径 ──────────────────────────────────────────────────
filepath=""

if [ -p /dev/stdin ] && command -v jq &>/dev/null; then
  filepath=$(jq -r '.tool_response.filePath // .tool_input.file_path // ""' 2>/dev/null || true)
fi

if [ -z "$filepath" ] || [ "$filepath" = "null" ]; then
  filepath="${CLAUDE_CODE_TOOL_RESULT_FILEPATH:-}"
fi

[ -z "$filepath" ] && exit 0
[ ! -f "$filepath" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

JAVA_LINT=""
PYTHON_LINT=""
TS_LINT=""

# ── ESLint 配置检测 ───────────────────────────────────────────────────
has_eslint_config() {
  [ -f "$PROJECT_DIR/eslint.config.js" ] || \
  [ -f "$PROJECT_DIR/eslint.config.mjs" ] || \
  [ -f "$PROJECT_DIR/.eslintrc.js" ] || \
  [ -f "$PROJECT_DIR/.eslintrc.json" ] || \
  [ -f "$PROJECT_DIR/.eslintrc" ]
}

# ── 2. 按文件类型执行验证 ────────────────────────────────────────────

case "$filepath" in
  *.java)
    # Java: checkstyle（如果项目配置了 checkstyle.xml）
    if [ "$JAVA_LINT" != "none" ] && command -v "${JAVA_LINT%% *}" &>/dev/null; then
      for conf in "$PROJECT_DIR/checkstyle.xml" "$PROJECT_DIR/config/checkstyle/checkstyle.xml"; do
        if [ -f "$conf" ]; then
          output=$($JAVA_LINT -c "$conf" "$filepath" 2>&1 | grep -iE "error|warning" | head -20 || true)
          if [ -n "$output" ]; then
            echo "[style-verify] ⚠ Java 代码风格问题："
            echo "$output"
            echo "[style-verify] 运行 $JAVA_LINT -c $conf $filepath 查看完整报告。"
          fi
        fi
      done
    fi
    ;;

  *.py)
    # Python: ruff check
    if [ "$PYTHON_LINT" != "none" ] && command -v "${PYTHON_LINT%% *}" &>/dev/null; then
      output=$($PYTHON_LINT "$filepath" 2>/dev/null || true)
      if [ -n "$output" ]; then
        echo "[style-verify] ⚠ Python 代码风格问题："
        echo "$output" | head -20
        echo "[style-verify] 请使用 $PYTHON_LINT $filepath 查看完整报告。"
      fi
    fi
    ;;

  *.ts|*.tsx|*.js|*.jsx)
    # TypeScript/JavaScript: eslint
    if [ "$TS_LINT" != "none" ] && command -v npx &>/dev/null && has_eslint_config; then
      output=$(cd "$PROJECT_DIR" && npx $TS_LINT "$filepath" 2>/dev/null || true)
      if [ -n "$output" ]; then
        echo "[style-verify] ⚠ TypeScript/JavaScript 代码风格问题："
        echo "$output" | head -20
        echo "[style-verify] 请运行 npx $TS_LINT $filepath 查看完整报告。"
      fi
    fi
    ;;

  *.html|*.css|*.scss|*.less)
    # 前端模板/样式文件：eslint（如果项目已配置）
    if [ "$TS_LINT" != "none" ] && command -v npx &>/dev/null && has_eslint_config; then
      output=$(cd "$PROJECT_DIR" && npx $TS_LINT "$filepath" 2>/dev/null || true)
      if [ -n "$output" ]; then
        echo "[style-verify] ⚠ 前端文件代码风格问题："
        echo "$output" | head -10
        echo "[style-verify] 请运行 npx $TS_LINT $filepath 查看完整报告。"
      fi
    fi
    ;;
esac

exit 0
