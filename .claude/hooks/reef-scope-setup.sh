#!/bin/bash
# reef-scope-setup.sh
# 安装/卸载 pre-commit hook + 配置文件
#
# 用法:
#   bash reef-scope-setup.sh install    # 安装
#   bash reef-scope-setup.sh uninstall  # 卸载

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"

SCOPE_CONFIG_DIR="${PROJECT_ROOT}/.deepflow"
SCOPE_CONFIG="${SCOPE_CONFIG_DIR}/scope-config.json"
GIT_HOOK_DIR="${PROJECT_ROOT}/.git/hooks"
PRE_COMMIT_HOOK="${GIT_HOOK_DIR}/pre-commit"

# ── 辅助函数 ─────────────────────────────────────────────────────

install() {
  echo "🔧 [Scope] 正在安装分支范围检查..."
  echo ""

  # 1. 创建配置文件
  echo "[1/3] 创建配置文件..."
  mkdir -p "$SCOPE_CONFIG_DIR"

  if [ ! -f "$SCOPE_CONFIG" ]; then
    cat > "$SCOPE_CONFIG" <<CONFIG
{
  "enabled": true,
  "ciEnabled": true,
  "domains": [],
  "description": "分支范围检查配置",
  "note": "domains 为空时使用 AI 自由分类。可在此列出项目业务领域以实现对齐。"
}
CONFIG
    echo "  ✅ 配置文件已创建: $SCOPE_CONFIG"
  else
    echo "  ℹ️  配置文件已存在，跳过"
  fi

  # 2. 安装 pre-commit hook
  echo "[2/3] 安装 pre-commit hook..."
  local hook_content
  hook_content=$(cat <<'HOOK'
#!/bin/bash
# reef-scope pre-commit hook — 分支范围检查
# 由 reef scope setup 安装，请勿手动修改

set -euo pipefail

# 查找 reef hook 脚本
REEF_SCOPE_GATE=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 可能的查找路径
for candidate in \
  "${PROJECT_ROOT}/node_modules/@deepflow/reef/hooks/reef-scope-gate.sh" \
  "${DEEPFLOW_PLUGIN_ROOT}/hooks/reef-scope-gate.sh" \
  "${CLAUDE_PLUGIN_ROOT}/hooks/reef-scope-gate.sh"; do
  if [ -f "$candidate" ]; then
    REEF_SCOPE_GATE="$candidate"
    break
  fi
done

if [ -z "$REEF_SCOPE_GATE" ]; then
  exit 0
fi

bash "$REEF_SCOPE_GATE"
HOOK

  # 检查是否已有 pre-commit hook
  if [ -f "$PRE_COMMIT_HOOK" ]; then
    # chain 模式：检查是否已包含 reef-scope
    if grep -q "reef-scope" "$PRE_COMMIT_HOOK" 2>/dev/null; then
      echo "  ℹ️  reef-scope hook 已安装，跳过"
    else
      # 备份原有 hook，追加 reef-scope 调用
      echo "  ℹ️  检测到已有 pre-commit hook，采用 chain 模式追加"
      cat >> "$PRE_COMMIT_HOOK" <<'APPEND'

# --- reef-scope branch scope check ---
if [ -f "$(dirname "$0")/../.deepflow/scope-config.json" ]; then
  export DEEPFLOW_PLUGIN_ROOT="$REEF_SCOPE_GATE"
  bash "$(dirname "$0")/../.deepflow/hooks/reef-scope-gate.sh" 2>/dev/null || true
fi
APPEND
      chmod +x "$PRE_COMMIT_HOOK"
      echo "  ✅ Hook 已追加到已有 pre-commit hook"
    fi
  else
    # 创建新的 pre-commit hook
    echo "$hook_content" > "$PRE_COMMIT_HOOK"
    chmod +x "$PRE_COMMIT_HOOK"
    echo "  ✅ Pre-commit hook 已安装: $PRE_COMMIT_HOOK"
  fi

  # 3. 注册到 hooks.json（如适用）
  echo "[3/3] 检查 hooks.json 注册..."
  local hooks_json="${SCRIPT_DIR}/hooks.json"
  if [ -f "$hooks_json" ]; then
    # 检查是否已注册
    if grep -q "reef-scope" "$hooks_json" 2>/dev/null; then
      echo "  ℹ️  hooks.json 中已注册，跳过"
    else
      echo "  ℹ️  reef-scope 不需要注册到 Claude Code hooks.json，使用独立 git hook"
    fi
  fi

  echo ""
  echo "✅ Scope 检查安装完成！"
  echo ""
  echo "  配置文件: $SCOPE_CONFIG"
  echo "  编辑配置可启用/禁用或设置领域对齐"
  echo ""
  echo "  测试命令:"
  echo "    git diff main...HEAD | bash ${SCRIPT_DIR}/reef-scope-check.sh"
}

uninstall() {
  echo "🔧 [Scope] 正在卸载分支范围检查..."
  echo ""

  # 1. 移除 pre-commit hook 中的 reef-scope 部分
  if [ -f "$PRE_COMMIT_HOOK" ]; then
    if grep -q "reef-scope" "$PRE_COMMIT_HOOK" 2>/dev/null; then
      # 如果整个文件都是 reef-scope 的，删除文件
      if [ "$(grep -c "reef-scope" "$PRE_COMMIT_HOOK" 2>/dev/null || true)" -gt 3 ]; then
        rm "$PRE_COMMIT_HOOK"
        echo "  ✅ 已删除 pre-commit hook"
      else
        # 否则只移除追加的部分
        sed -i '' '/# --- reef-scope branch scope check ---/,/true/d' "$PRE_COMMIT_HOOK" 2>/dev/null || true
        echo "  ✅ 已从 pre-commit hook 中移除 reef-scope 检查"
      fi
    else
      echo "  ℹ️  pre-commit hook 中未包含 reef-scope，无需移除"
    fi
  fi

  # 2. 保留配置文件（用户可选择手动删除）
  if [ -f "$SCOPE_CONFIG" ]; then
    echo "  ℹ️  配置文件保留: $SCOPE_CONFIG"
    echo "  如需删除: rm $SCOPE_CONFIG"
  fi

  echo ""
  echo "✅ Scope 检查已卸载！"
}

status() {
  echo "🔍 [Scope] 当前状态："
  echo ""

  if [ -f "$SCOPE_CONFIG" ]; then
    echo "  配置文件: ✅ 已安装 ($SCOPE_CONFIG)"
    echo "  内容:"
    cat "$SCOPE_CONFIG" | python3 -m json.tool 2>/dev/null || cat "$SCOPE_CONFIG"
  else
    echo "  配置文件: ❌ 未安装"
  fi
  echo ""

  if [ -f "$PRE_COMMIT_HOOK" ] && grep -q "reef-scope" "$PRE_COMMIT_HOOK" 2>/dev/null; then
    echo "  Pre-commit hook: ✅ 已安装"
  else
    echo "  Pre-commit hook: ❌ 未安装"
  fi

  local check_script="${SCRIPT_DIR}/reef-scope-check.sh"
  if [ -f "$check_script" ]; then
    echo "  核心脚本: ✅ 就绪 ($check_script)"
  else
    echo "  核心脚本: ❌ 未找到"
  fi
}

# ── 主入口 ──────────────────────────────────────────────────────

main() {
  case "${1:-help}" in
    install) install ;;
    uninstall) uninstall ;;
    status) status ;;
    help|--help|-h)
      echo "用法: bash reef-scope-setup.sh <命令>"
      echo ""
      echo "命令:"
      echo "  install    安装 pre-commit hook + 配置文件"
      echo "  uninstall  卸载 pre-commit hook"
      echo "  status     查看安装状态"
      echo ""
      echo "也可通过 reef CLI 调用: reef scope setup/uninstall/status"
      ;;
    *) echo "未知命令: $1"; exit 1 ;;
  esac
}

main "$@"
