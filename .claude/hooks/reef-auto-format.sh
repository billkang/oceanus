#!/bin/bash
# reef-auto-format.sh
# PostToolUse: 在 Edit/Write 后自动格式化代码
#
# 从 stdin JSON 解析文件路径（标准 Claude Code hook 协议），
# 同时支持 $CLAUDE_CODE_TOOL_RESULT_FILEPATH 环境变量作为降级。
#
# 格式化顺序（按文件类型）：
#   Java:   google-java-format（强制，详见 wizard.json）
#   Python: isort / ruff check --fix → ruff format / black
#   TS/JS:  Prettier（按需）→ eslint --fix → organizeImports（按需）
#   Go:     gofmt -w
#   Rust:   rustfmt
#
# 新增能力（v2）：
#   - VS Code 配置检测：自动读取 .vscode/settings.json 决定启用哪些格式化
#   - Prettier 支持：自动检测 prettier 配置文件并执行 prettier --write
#   - Organize Imports：TypeScript source.organizeImports 等价
#   - Python isort 支持：自动排序 Python import
#   - 配置缓存：首次检测后缓存结果，避免重复 I/O
#
# 配置优先级：.vscode/settings.json > wizard.json > 工具自动检测

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

# ── 2. VS Code 配置检测（带缓存） ────────────────────────────────────
# 缓存文件：${TMPDIR:-/tmp}/reef-vscode-settings-{project-key} / <mtime>
# 缓存内容：
#   line 1: .vscode/settings.json 的 mtime
#   line 2: USE_PRETTIER=true/false
#   line 3: USE_ORGANIZE_IMPORTS=true/false

# Handlebars 变量从 wizard.json 注入，未注入时默认启用（按 spec）
USE_PRETTIER=""
[ -z "$USE_PRETTIER" ] && USE_PRETTIER="true"

USE_ORGANIZE_IMPORTS=""
[ -z "$USE_ORGANIZE_IMPORTS" ] && USE_ORGANIZE_IMPORTS="true"

PRETTIER_SOURCE="wizard"

detect_vscode_settings() {
  local settings_file="$PROJECT_DIR/.vscode/settings.json"
  local cache_key="${PROJECT_DIR//\//_}"
  local cache_file="${TMPDIR:-/tmp}/reef-vscode-settings-${cache_key}"

  [ ! -f "$settings_file" ] && return 0

  # 获取当前 mtime，与缓存比较
  local current_mtime=""
  if command -v stat &>/dev/null; then
    current_mtime=$(stat -c "%Y" "$settings_file" 2>/dev/null || stat -f "%m" "$settings_file" 2>/dev/null || echo "")
  fi

  local cached_mtime=""
  [ -f "$cache_file" ] && cached_mtime=$(head -1 "$cache_file" 2>/dev/null || echo "")

  # 缓存有效，直接读取
  if [ -n "$current_mtime" ] && [ "$current_mtime" = "$cached_mtime" ] && [ -f "$cache_file" ]; then
    local line=0
    while IFS= read -r line_value; do
      line=$((line + 1))
      case $line in
        2) USE_PRETTIER="$line_value" ;;
        3) USE_ORGANIZE_IMPORTS="$line_value" ;;
      esac
    done < "$cache_file"
    PRETTIER_SOURCE="vscode"
    return 0
  fi

  # 缓存无效，重新解析（需要 jq）
  if ! command -v jq &>/dev/null; then
    return 0
  fi

  local has_prettier="false"
  local has_organize_imports="false"

  # 读取 editor.defaultFormatter
  local default_formatter
  default_formatter=$(jq -r '.["editor.defaultFormatter"] // ""' "$settings_file" 2>/dev/null || echo "")

  # 读取 editor.formatOnSave
  local format_on_save
  format_on_save=$(jq -r '.["editor.formatOnSave"] // "false"' "$settings_file" 2>/dev/null || echo "false")

  # 检测 Prettier：defaultFormatter 包含 prettier 且 formatOnSave 为 true
  if [ "$format_on_save" = "true" ] && echo "$default_formatter" | grep -qi "prettier"; then
    has_prettier="true"
  fi

  # 读取 editor.codeActionsOnSave.source.organizeImports
  local organize_imports
  organize_imports=$(jq -r '.["editor.codeActionsOnSave"]["source.organizeImports"] // "false"' "$settings_file" 2>/dev/null || echo "false")
  if [ "$organize_imports" = "true" ]; then
    has_organize_imports="true"
  fi

  # 写入缓存
  {
    echo "$current_mtime"
    echo "$has_prettier"
    echo "$has_organize_imports"
  } > "$cache_file" 2>/dev/null || true

  USE_PRETTIER="$has_prettier"
  USE_ORGANIZE_IMPORTS="$has_organize_imports"
  PRETTIER_SOURCE="vscode"
}

# ── 3. Prettier 检测 ────────────────────────────────────────────────
# 检测项目是否配置了 Prettier（通过配置文件）
detect_prettier_config() {
  local prettier_configs=(
    ".prettierrc"
    ".prettierrc.json"
    ".prettierrc.yaml"
    ".prettierrc.yml"
    ".prettierrc.toml"
    ".prettierrc.js"
    ".prettierrc.cjs"
    "prettier.config.js"
    "prettier.config.cjs"
  )
  local config
  for config in "${prettier_configs[@]}"; do
    if [ -f "$PROJECT_DIR/$config" ]; then
      return 0
    fi
  done
  return 1
}

# ── 4. 执行格式化（按文件类型） ──────────────────────────────────────

case "$filepath" in
  *.java)
    # Java: google-java-format 自动格式化（可配置命令通过  注入）
    FMT=""
    if [ "$FMT" != "none" ]; then
      TOOL="${FMT%% *}"
      if command -v "$TOOL" &>/dev/null; then
        $FMT "$filepath"
      elif [ -f "$PROJECT_DIR/$TOOL.jar" ]; then
        java -jar "$PROJECT_DIR/$TOOL.jar" -i "$filepath"
      else
        echo "[auto-format] ⚠ $TOOL not found. Install: brew install google-java-format"
      fi
    fi
    ;;
  *.py)
    # Python: import 排序（isort）→ 格式化（ruff format / black）
    if [ "$USE_ORGANIZE_IMPORTS" = "true" ]; then
      if command -v isort &>/dev/null; then
        isort "$filepath"
      elif command -v ruff &>/dev/null; then
        ruff check --select I --fix "$filepath"
      fi
    fi
    # 格式化
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

    # 检测 VS Code 配置（首次运行时）
    detect_vscode_settings

    # Step 1: Prettier 格式化（仅在启用时且检测到 prettier 配置时执行）
    if [ "$PRETTIER_SOURCE" = "vscode" ] && [ "$USE_PRETTIER" = "true" ]; then
      if detect_prettier_config; then
        cd "$PROJECT_DIR" && npx prettier --write "$filepath" 2>/dev/null || true
      fi
    elif [ "$PRETTIER_SOURCE" = "wizard" ] && [ "$USE_PRETTIER" = "true" ]; then
      # wizard.json 启用 Prettier 时，只要有 prettier 包就执行
      if command -v npx &>/dev/null && npx prettier --version &>/dev/null 2>&1; then
        cd "$PROJECT_DIR" && npx prettier --write "$filepath" 2>/dev/null || true
      fi
    fi

    # Step 2: ESLint --fix
    remaining=$(cd "$PROJECT_DIR" && npx eslint --fix "$filepath" 2>/dev/null || true)
    if [ -n "$remaining" ]; then
      echo "[auto-format] ⚠ 以下 ESLint 错误需要手动修复："
      echo "$remaining"
      echo "[auto-format] 请运行 pnpm lint 查看完整报告。"
    fi

    # Step 3: TypeScript organize imports（仅在 .ts/.tsx 且启用时）
    # 工具优先级：eslint import 插件 → prettier-plugin-organize-imports → eslint-plugin-simple-import-sort
    # prettier + eslint --fix 已覆盖大多数场景；本步骤作为兜底，确保 import 排序发生
    if [[ "$filepath" == *.ts || "$filepath" == *.tsx ]]; then
      if [ "$USE_ORGANIZE_IMPORTS" = "true" ] && [ -f "$PROJECT_DIR/tsconfig.json" ]; then
        # 尝试常见的 import 排序 CLI 工具
        if command -v npx &>/dev/null; then
          npx ts-organize-imports "$filepath" 2>/dev/null ||
          npx organize-imports-cli "$filepath" 2>/dev/null ||
          true
        fi
      fi
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
