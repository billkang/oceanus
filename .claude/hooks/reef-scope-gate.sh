#!/bin/bash
# reef-scope-gate.sh
# 门禁执行层：在 git commit / CI 时运行范围检查并阻断
#
# 用法：
#   bash reef-scope-gate.sh              # pre-commit 模式
#   bash reef-scope-gate.sh --ci          # CI 模式
#
# exit code:
#   0 = 通过（单领域或无变更）
#   2 = 阻断（多领域）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
SCOPE_CHECK="${SCRIPT_DIR}/reef-scope-check.sh"

# ── 主逻辑 ──────────────────────────────────────────────────────

main() {
  local mode="local"
  local from_branch="main"

  while [ $# -gt 0 ]; do
    case "$1" in
      --ci) mode="ci"; shift ;;
      --diff-from) from_branch="$2"; shift 2 ;;
      --help|-h)
        echo "用法: reef-scope-gate.sh [选项]"
        echo "  --ci              CI 模式"
        echo "  --diff-from <分支> 指定比较基准分支"
        exit 0
        ;;
      *) shift ;;
    esac
  done

  # 运行范围检查，获取原始 JSON 结果
  local result
  result="$("$SCOPE_CHECK" --diff-from "$from_branch" --raw 2>/dev/null)" || true

  # 提取 domain 列表（排除 documentation）
  local domains_json
  domains_json="$(echo "$result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    nd = [d for d in r.get('domains', []) if d.get('name') != 'documentation']
    print(json.dumps(nd, ensure_ascii=False))
except:
    print('[]')
" 2>/dev/null || echo "[]")"

  # 判断是否需要阻断
  local domain_count
  domain_count="$(echo "$domains_json" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")"

  if [ "$domain_count" -le 1 ]; then
    # 通过
    exit 0
  fi

  # ── 阻断 — 输出格式化报告 ──────────────────────────────────

  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  🚫  分支范围检查未通过                                ║"
  echo "║      当前分支涉及 $domain_count 个业务领域                  ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""

  echo "$domains_json" | python3 -c "
import json, sys
domains = json.load(sys.stdin)
for d in domains:
    name = d.get('name', '?')
    conf = d.get('confidence', 0)
    expl = d.get('explanation', '')
    flag = ' ⚠️ 需人工确认' if conf < 0.6 else ''
    print(f'  领域: {name} (可信度: {conf:.2f}){flag}')
    print(f'  说明: {expl}')
    print()
" 2>/dev/null

  echo "  ── 建议 ──"
  echo "  每个分支应只专注于一个业务领域。建议将当前变更拆分为"
  echo "  多个独立分支，分别提交。"
  echo ""

  # 获取拆分建议
  local split_info
  split_info="$(echo "$result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    for s in r.get('suggested_split', []):
        print(f'    → {s.get(\"branch_name\", \"?\")}: {s.get(\"description\", \"\")}')
except:
    print('    (暂无拆分建议)')
" 2>/dev/null)"

  if [ -n "$split_info" ] && [ "$split_info" != "    (暂无拆分建议)" ]; then
    echo "  ── 建议的拆分方案 ──"
    echo "$split_info"
    echo ""
  fi

  echo "  提示: 使用 'reef scope split' 命令可自动执行拆分"
  echo ""

  exit 2
}

main "$@"
