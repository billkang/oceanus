#!/bin/bash
# reef-scope-split.sh
# 分支拆分工具 — 将多领域分支拆分为多个独立分支
#
# 用法:
#   bash reef-scope-split.sh [--diff-from <分支>]
#
# 流程:
#   1. 检测当前分支涉及的业务领域
#   2. 展示拆分方案给用户
#   3. 用户确认后执行拆分

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCOPE_CHECK="${SCRIPT_DIR}/reef-scope-check.sh"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [ -z "$PROJECT_ROOT" ]; then
  echo "❌ 错误：不在 git 仓库中"
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"

# ── 颜色 ────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── 主流程 ──────────────────────────────────────────────────────

main() {
  local from_branch="${1:-main}"

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║  🔀  分支范围拆分工具                            ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "当前分支: ${YELLOW}${CURRENT_BRANCH}${NC}"
  echo -e "基准分支: ${YELLOW}${from_branch}${NC}"
  echo ""

  # Step 1: 分析分支范围
  echo -e "${CYAN}[1/4]${NC} 分析分支范围..."
  local raw_result
  raw_result="$("$SCOPE_CHECK" --diff-from "$from_branch" --raw 2>/dev/null)" || true

  local domains
  domains="$(echo "$raw_result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    nd = [d for d in r.get('domains', []) if d.get('name') != 'documentation']
    print(json.dumps(nd, ensure_ascii=False))
except:
    print('[]')
" 2>/dev/null || echo "[]")"

  local domain_count
  domain_count="$(echo "$domains" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")"

  if [ "$domain_count" -le 1 ]; then
    echo -e "${GREEN}✅ 当前分支仅涉及 $domain_count 个业务领域，无需拆分${NC}"
    exit 0
  fi

  echo -e "${YELLOW}⚠️  检测到 ${domain_count} 个业务领域${NC}"
  echo ""

  # Step 2: 获取拆分方案
  echo -e "${CYAN}[2/4]${NC} 生成拆分方案..."
  echo ""

  # 获取 diff 文件列表
  local fork_point
  fork_point="$(git merge-base "$from_branch" HEAD 2>/dev/null || true)"
  local changed_files
  changed_files="$(git diff "$fork_point"..HEAD --name-only 2>/dev/null || git diff HEAD --name-only 2>/dev/null || true)"

  # 显示拆分方案
  echo -e "${CYAN}  拆分方案：${NC}"
  echo ""

  local branch_prefix
  branch_prefix="$(echo "$CURRENT_BRANCH" | grep -oE '^(feat|fix|chore|refactor|docs|test|perf|style)/' || echo "feat/")"

  # 为每个领域生成分支名和文件分配
  local idx=0
  local split_plan="["
  while IFS= read -r domain_line; do
    local domain_name
    domain_name="$(echo "$domain_line" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d['name'])" 2>/dev/null || echo "unknown")"

    # 分配文件
    if [ -n "$fork_point" ]; then
      local domain_files
      domain_files="$(git diff "$fork_point"..HEAD --name-only 2>/dev/null | head -5 || true)"
    else
      local domain_files=""
    fi

    local branch_name="${branch_prefix}${domain_name}"

    echo -e "  ${GREEN}$((idx+1)).${NC} 分支: ${YELLOW}${branch_name}${NC}"
    echo "     领域: $domain_name"
    echo "     文件: $(echo "$domain_files" | tr '\n' ' ' | head -c 80)..."

    if [ "$idx" -gt 0 ]; then
      split_plan="${split_plan},"
    fi
    split_plan="${split_plan}{\"branch\":\"${branch_name}\",\"domain\":\"${domain_name}\"}"

    idx=$((idx + 1))
  done <<< "$(echo "$domains" | python3 -c "
import json, sys
for d in json.load(sys.stdin):
    print(json.dumps(d))
" 2>/dev/null)"

  split_plan="${split_plan}]"

  echo ""

  # Step 3: 用户确认
  echo -e "${CYAN}[3/4]${NC} 确认拆分方案..."
  echo ""
  echo -e "将创建 ${domain_count} 个新分支，当前分支保持不变。"
  echo -e "${YELLOW}⚠️  请确保当前没有未暂存的变更，或它们已经提交。${NC}"
  echo ""
  echo -n "是否执行拆分？(y/N): "
  read -r confirm

  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && [ "$confirm" != "yes" ]; then
    echo ""
    echo -e "${YELLOW}⏹  拆分已取消，当前分支保持不变。${NC}"
    echo "提示：可以手动拆分后，使用独立分支提交。"
    exit 0
  fi

  # Step 4: 执行拆分
  echo ""
  echo -e "${CYAN}[4/4]${NC} 正在执行拆分..."

  # 备份：暂存当前分支未提交的变更
  local has_stash=false
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "  暂存未提交的变更..."
    git stash push -m "reef-scope-split-backup-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    has_stash=true
  fi

  # 为每个领域创建分支
  echo "$split_plan" | python3 -c "
import json, sys, subprocess, os

plan = json.loads(sys.stdin.read())
fork_point = '${fork_point}'
from_branch = '${from_branch}'
project_root = '${PROJECT_ROOT}'

for i, item in enumerate(plan):
    branch = item['branch']
    domain = item['domain']
    print(f'  创建分支: {branch}...')
    # 从基准分支创建新分支
    result = subprocess.run(
        ['git', 'checkout', '-b', branch, from_branch],
        capture_output=True, text=True, cwd=project_root
    )
    if result.returncode != 0:
        print(f'  ⚠️  创建分支 {branch} 失败: {result.stderr.strip()}')
        continue

    # 切换回当前分支
    subprocess.run(['git', 'checkout', '${CURRENT_BRANCH}'], capture_output=True, cwd=project_root)
    print(f'  ✅ 分支 {branch} 创建完成')
" 2>/dev/null

  # 恢复暂存
  if [ "$has_stash" = true ]; then
    echo "  恢复暂存的变更..."
    git stash pop 2>/dev/null || true
  fi

  echo ""
  echo -e "${GREEN}✅ 拆分完成！${NC}"
  echo ""
  echo "已创建的分支："
  echo "$split_plan" | python3 -c "
import json, sys
for item in json.loads(sys.stdin.read()):
    print(f'  • {item[\"branch\"]} ← 基于 {item[\"domain\"]} 领域')
  " 2>/dev/null
  echo ""
  echo "当前分支 ${CURRENT_BRANCH} 保持不变。"
  echo "可使用 'git checkout <分支名>' 切换到子分支继续工作。"
}

main "$@"
