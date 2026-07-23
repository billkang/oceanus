#!/bin/bash
# reef-scope-ci.sh
# CI 门禁脚本 — 在 CI/PR 中检查分支范围
#
# 用法：
#   方式1（自动获取 PR diff）:
#     reef-scope-ci.sh --base main
#
#   方式2（从 stdin 传入 diff）:
#     git diff main...HEAD | reef-scope-ci.sh
#
# 适用于:
#   GitHub Actions, GitLab CI, Jenkins 等
#
# exit code:
#   0 = 通过
#   2 = 阻断（多领域）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCOPE_GATE="${SCRIPT_DIR}/reef-scope-gate.sh"

echo "🔍 [Scope Check] 正在检查分支范围..."
echo ""

# 传给 gate 脚本，加上 --ci 标记
exec "$SCOPE_GATE" --ci "$@"
