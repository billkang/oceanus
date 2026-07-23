#!/bin/bash
# stash-and-switch.sh
# git stash → checkout main → pull → checkout -b → stash pop
#
# 用法:
#   bash stash-and-switch.sh <new-branch-name>
#
# 说明:
#   自动处理 stash 保存和恢复当前工作区变更。
#   新分支基于 main 的最新提交。

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: bash $0 <new-branch-name>"
  exit 1
fi

NEW_BRANCH="$1"
STASHED=false

# stash 当前变更（如有）
if [ -n "$(git status --porcelain)" ]; then
  echo "📦 暂存当前未提交变更..."
  git stash push -m "stash-and-switch-auto-stash"
  STASHED=true
fi

# 切换到 main 并更新
echo "🔀 切换到 main..."
git checkout main
git pull origin main 2>/dev/null || echo "  ⚠️  pull 失败（可能无远程）"

# 创建新分支
echo "🌿 创建新分支: $NEW_BRANCH"
git checkout -b "$NEW_BRANCH"

# 恢复暂存的变更
if [ "$STASHED" = true ]; then
  echo "📦 恢复暂存的变更..."
  git stash pop
fi

echo "✅ 已切换到新分支: $NEW_BRANCH"
