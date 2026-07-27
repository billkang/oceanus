#!/bin/bash
# reef-scope-check.sh
# Core: AI 语义分析 git diff，检测业务领域范围
#
# 功能：
#   1. 接收 git diff 输入（stdin 或自动获取）
#   2. 调用 LLM API（默认 Claude）分析涉及的业务领域
#   3. 输出结构化 JSON 报告
#
# 用法：
#   git diff main...HEAD | bash reef-scope-check.sh
#   bash reef-scope-check.sh --diff-from main
#
# 依赖：
#   - .env 文件中的 ANTHROPIC_API_KEY（或其他 LLM API key）
#   - curl (用于 API 调用)

set -euo pipefail

# ── 配置 ──────────────────────────────────────────────────────────

# 默认 LLM API 配置
LLM_API_URL="${LLM_API_URL:-https://api.anthropic.com/v1/messages}"
LLM_API_KEY="${ANTHROPIC_API_KEY:-${LLM_API_KEY:-}}"
LLM_MODEL="${LLM_MODEL:-claude-sonnet-4-20250514}"

# 项目根目录（自动检测 git 仓库根目录）
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"

# 项目配置文件（读取 settings.json 的 reef.scope）
DEEPSTORM_SETTINGS="${PROJECT_ROOT}/.deepstorm/settings.json"

# diff 大小限制（字符数），超过则截断采样
MAX_DIFF_CHARS="${MAX_DIFF_CHARS:-20000}"

# ── 辅助函数 ─────────────────────────────────────────────────────

# 读取配置文件（支持 enable/disable、领域对齐列表）
# 从 settings.json → reef.scope 读取
read_config() {
  if [ -f "$DEEPSTORM_SETTINGS" ]; then
    local scope_config
    scope_config=$(python3 -c "
import json, sys
try:
    with open('$DEEPSTORM_SETTINGS') as f:
        s = json.load(f)
    scope = s.get('reef', {}).get('scope', None)
    if scope:
        result = {'enabled': scope.get('enabled', True), 'ciEnabled': scope.get('ciEnabled', True), 'domains': scope.get('domains', [])}
        print(json.dumps(result))
    else:
        print('NOT_FOUND')
except:
    print('NOT_FOUND')
" 2>/dev/null) || scope_config="NOT_FOUND"

    if [ "$scope_config" != "NOT_FOUND" ]; then
      echo "$scope_config"
      return
    fi
  fi

  echo '{"enabled": true, "domains": [], "ciEnabled": true}'
}

# 检查 scope 检查是否启用
is_enabled() {
  local mode="${1:-local}"  # local 或 ci
  local config
  config="$(read_config)"

  if [ "$mode" = "ci" ]; then
    echo "$config" | python3 -c "import json,sys; c=json.load(sys.stdin); print(str(c.get('ciEnabled', c.get('enabled', True))).lower())" 2>/dev/null || echo "true"
  else
    echo "$config" | python3 -c "import json,sys; c=json.load(sys.stdin); print(str(c.get('enabled', True)).lower())" 2>/dev/null || echo "true"
  fi
}

# 获取分支 diff
get_diff() {
  local from_branch="${1:-main}"

  # 若通过 stdin 提供 diff，直接读取
  if [ ! -t 0 ]; then
    cat
    return
  fi

  # 否则自动获取当前分支与目标分支的 diff
  local fork_point
  fork_point="$(git merge-base "$from_branch" HEAD 2>/dev/null || echo "")"
  if [ -n "$fork_point" ]; then
    git diff "$fork_point"..HEAD 2>/dev/null || git diff HEAD 2>/dev/null || true
  else
    git diff HEAD 2>/dev/null || true
  fi
}

# 截断大 diff — 保留文件头和部分上下文
truncate_diff() {
  local input
  input="$(cat)"
  local len="${#input}"

  if [ "$len" -le "$MAX_DIFF_CHARS" ]; then
    echo "$input"
    return
  fi

  # 截断：保留文件变更列表 + 每文件的部分 diff
  echo "$input" | head -c "$MAX_DIFF_CHARS"
  echo ""
  echo "... [diff truncated at ${MAX_DIFF_CHARS} chars, ${len} total]"
}

# 调用 LLM API 进行领域分析
call_llm_analysis() {
  local diff_content="$1"
  local config
  config="$(read_config)"

  # 获取领域对齐列表（如果有）
  local domains_hint=""
  domains_hint="$(echo "$config" | python3 -c "
import json, sys
try:
    c = json.load(sys.stdin)
    domains = c.get('domains', [])
    if domains:
        print('项目已定义的业务领域：' + ', '.join(domains))
    else:
        print('')
except:
    print('')
" 2>/dev/null || echo "")"

  # 构建分析 prompt
  local prompt
  prompt=$(cat <<PROMPT
你是一个代码变更分析专家。你需要分析以下 git diff 内容，判断它涉及哪些业务领域。

$domains_hint

请按以下 JSON 格式输出分析结果（不要输出其他内容）：

{
  "domains": [
    {
      "name": "业务领域英文名(kebab-case)",
      "confidence": 0.0-1.0,
      "explanation": "为什么这段代码属于这个领域（中文）"
    }
  ],
  "summary": "整体变更说明（中文，一句话）",
  "suggested_split": [
    {
      "branch_name": "建议的分支名",
      "files_count": 0,
      "description": "该分支的变更说明"
    }
  ]
}

规则：
1. 领域数量 = 实际涉及的业务领域数量。如果只有一个领域，suggested_split 可以是空数组。
2. 可信度 < 0.6 时，标注 "需人工确认"
3. 文档变更归类为 "documentation" 领域
4. 不要编造领域，仅基于 diff 内容判断
5. 每个领域必须有对应的文件变更支撑

以下是 diff 内容：

\`\`\`diff
${diff_content}
\`\`\`
PROMPT
)

  # API 调用 - 支持不同 LLM 提供商
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    # Claude API
    local response
    response=$(curl -s -w "\n%{http_code}" "$LLM_API_URL" \
      -H "Content-Type: application/json" \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -d "$(cat <<JSONBODY
{
  "model": "$LLM_MODEL",
  "max_tokens": 2048,
  "system": "你是一个代码变更分析专家。你的任务是通过分析 git diff 来确定代码变更涉及的业务领域。只输出 JSON。",
  "messages": [
    {"role": "user", "content": "$(echo "$prompt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "$prompt")"}
  ]
}
JSONBODY
    )" 2>/dev/null || echo '{"error":"API call failed"}')

    local http_code
    http_code="$(echo "$response" | tail -1)"
    local body
    body="$(echo "$response" | sed '$d')"

    if [ "$http_code" != "200" ]; then
      echo "{\"error\":\"API returned $http_code\",\"domains\":[],\"summary\":\"API 调用失败，跳过范围检查\",\"suggested_split\":[]}"
      return
    fi

    # 提取 content 中的 JSON
    echo "$body" | python3 -c "
import json, sys
try:
    resp = json.load(sys.stdin)
    content = resp.get('content', [])
    for block in content:
        if block.get('type') == 'text':
            text = block.get('text', '').strip()
            # 尝试提取 JSON（可能在 markdown 代码块中）
            if text.startswith('{'):
                print(text)
            elif '\`\`\`json' in text:
                start = text.index('\`\`\`json') + 7
                end = text.index('\`\`\`', start)
                print(text[start:end].strip())
            elif '\`\`\`' in text:
                start = text.index('\`\`\`') + 3
                end = text.index('\`\`\`', start)
                print(text[start:end].strip())
            else:
                print(text)
except Exception as e:
    print(json.dumps({'error': str(e), 'domains': [], 'summary': '解析失败', 'suggested_split': []}))
" 2>/dev/null || echo "{\"domains\":[],\"summary\":\"分析失败\",\"suggested_split\":[]}"

  elif [ -n "$OPENAI_API_KEY" ]; then
    # OpenAI API（备选）
    local response
    response=$(curl -s -w "\n%{http_code}" "https://api.openai.com/v1/chat/completions" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -d "$(cat <<JSONBODY
{
  "model": "gpt-4o",
  "max_tokens": 2048,
  "messages": [
    {"role": "system", "content": "你是一个代码变更分析专家。分析 git diff 涉及的 business domain，只输出 JSON。"},
    {"role": "user", "content": "$(echo "$prompt" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo "$prompt")"}
  ]
}
JSONBODY
    )" 2>/dev/null || echo '{"error":"API call failed"}')

    local http_code
    http_code="$(echo "$response" | tail -1)"
    local body
    body="$(echo "$response" | sed '$d')"

    if [ "$http_code" != "200" ]; then
      echo "{\"error\":\"API returned $http_code\",\"domains\":[],\"summary\":\"API 调用失败，跳过范围检查\",\"suggested_split\":[]}"
      return
    fi

    echo "$body" | python3 -c "
import json, sys
try:
    resp = json.load(sys.stdin)
    text = resp['choices'][0]['message']['content']
    print(text)
except Exception as e:
    print(json.dumps({'error': str(e), 'domains': [], 'summary': '解析失败', 'suggested_split': []}))
" 2>/dev/null || echo "{\"domains\":[],\"summary\":\"分析失败\",\"suggested_split\":[]}"

  else
    # 无 API key 配置 — fallback 模式
    echo "{\"domains\":[],\"summary\":\"未配置 LLM API Key，跳过范围检查\",\"suggested_split\":[]}"
  fi
}

# ── 主逻辑 ────────────────────────────────────────────────────────

main() {
  local from_branch="main"
  local mode="local"  # local 或 ci
  local raw_output=false

  # 参数解析
  while [ $# -gt 0 ]; do
    case "$1" in
      --diff-from) from_branch="$2"; shift 2 ;;
      --ci-mode) mode="ci"; shift ;;
      --raw) raw_output=true; shift ;;
      --help|-h)
        echo "用法: reef-scope-check.sh [选项]"
        echo "  --diff-from <分支>  指定比较基准分支（默认: main）"
        echo "  --ci-mode           CI 模式，检查 CI 配置门禁"
        echo "  --raw               输出原始 JSON，不加格式"
        echo "  从 stdin 传入 diff: git diff main...HEAD | reef-scope-check.sh"
        exit 0
        ;;
      *) shift ;;
    esac
  done

  # 检查是否启用
  local enabled
  enabled="$(is_enabled "$mode")"
  if [ "$enabled" != "true" ]; then
    [ "$raw_output" = false ] && echo "ℹ️  Scope 检查已禁用（可通过 settings.json → reef.scope.enabled 启用）"
    echo "{\"enabled\":false,\"domains\":[],\"summary\":\"检查已禁用\",\"suggested_split\":[]}"
    exit 0
  fi

  # 获取 diff
  local diff
  diff="$(get_diff "$from_branch")"

  if [ -z "$diff" ]; then
    [ "$raw_output" = false ] && echo "ℹ️  无 diff 可分析"
    echo "{\"domains\":[],\"summary\":\"无变更\",\"suggested_split\":[]}"
    exit 0
  fi

  # 截断大 diff
  local truncated_diff
  truncated_diff="$(echo "$diff" | truncate_diff)"

  # 调用 LLM 分析
  local result
  result="$(call_llm_analysis "$truncated_diff")"

  # 输出结果
  if [ "$raw_output" = true ]; then
    echo "$result"
  else
    # 格式化输出
    local domain_count
    domain_count="$(echo "$result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    print(len(r.get('domains', [])))
except:
    print('0')
" 2>/dev/null || echo "0")"

    echo ""
    if [ "$domain_count" = "0" ]; then
      echo "✅ 未检测到明确的业务领域"
    elif [ "$domain_count" = "1" ]; then
      echo "✅ 检测到 1 个业务领域："
    else
      echo "⚠️  检测到 ${domain_count} 个业务领域："
    fi
    echo ""
    echo "$result" | python3 -c "
import json, sys
r = json.load(sys.stdin)
for d in r.get('domains', []):
    conf = d.get('confidence', 0)
    flag = ' ⚠️ 需人工确认' if conf < 0.6 else ''
    print(f'  • {d[\"name\"]} ({conf:.2f}){flag}')
    print(f'    {d.get(\"explanation\", \"\")}')
print()
print(f'  总结：{r.get(\"summary\", \"\")}')
if r.get('suggested_split'):
    print()
    print('  建议拆分方案：')
    for s in r['suggested_split']:
        print(f'    → {s[\"branch_name\"]}: {s.get(\"description\", \"\")}')
" 2>/dev/null || echo "$result"
  fi

  # 返回 domain 数量（用于 exit code）
  local count
  count="$(echo "$result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    print(len(r.get('domains', [])))
except:
    print('0')
" 2>/dev/null || echo "0")"

  # 纯检测模式：基于 domain 数量返回 exit code
  # 0 = 单领域或无领域（通过），1+ = 多领域（阻断）
  # documentation 领域不计入多领域阻断
  local non_doc_count
  non_doc_count="$(echo "$result" | python3 -c "
import json, sys
try:
    r = json.load(sys.stdin)
    nd = [d for d in r.get('domains', []) if d.get('name') != 'documentation']
    print(len(nd))
except:
    print('0')
" 2>/dev/null || echo "0")"

  if [ "$non_doc_count" -gt 1 ]; then
    exit 2  # 多领域 — 阻断
  else
    exit 0  # 通过
  fi
}

main "$@"
