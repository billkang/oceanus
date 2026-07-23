#!/bin/bash
# reef-intent-detect.sh
# UserPromptSubmit hook: 检测用户输入是否为开发需求，自动唤起 reef-start skill
#
# 部署路径：.claude/hooks/reef-intent-detect.sh
# 注册方式：通过 hooks.json 的 UserPromptSubmit 条目
#
# 工作原理：
#   1. 读取用户输入（环境变量 CLAUDE_INPUT）
#   2. 匹配开发意图关键词（中文 + 英文）
#   3. 匹配成功 → 输出 <system-reminder> 指令，指示 AI 调用 reef-start skill
#   4. 未匹配 → 静默退出，AI 正常处理

# 严格模式
set -euo pipefail

# ── 配置：开发意图关键词 ──────────────────────────────────────────
# 用户可以在此扩展关键词列表，添加新的匹配模式

# 中文开发意图关键词
ZH_DEV_PATTERNS=(
  # 新增功能
  "我想加" "我要加" "我需要" "帮我加" "帮我做" "帮我写"
  "加个" "搞个" "写个" "做个" "弄个"
  "加一个" "添加一个" "新增一个" "实现一个"
  "实现一下" "实现个" "帮我实现"
  "新增" "添加" "创建" "建立"
  "做个功能" "加个功能" "来个功能"

  # Bug 修复
  "修复" "修一下" "修一个" "修好" "修修"
  "有问题" "有bug" "有 bug" "不正常" "有毛病"
  "返回不对" "结果不对" "数据不对"
  "报错" "报错了" "出错了" "出错"
  "不工作" "不能用了" "坏了" "挂了"
  "bug" "Bug" "BUG"

  # 重构/优化
  "重构" "重写" "重做" "改造" "重改"
  "优化" "改善" "提升" "改进"
  "整理" "提取" "抽取" "拆分" "合并"
  "重新设计" "重新组织" "重构成"
  "改一下" "修改一下" "改动" "调整一下"

  # 代码修改
  "改成" "改为" "修改为" "变更"
  "把这个" "把那个" "把这些"
  "改代码" "写代码" "敲代码" "编码"
  "代码有点" "逻辑有点" "写法有点"
)

# 英文开发意图关键词
EN_DEV_PATTERNS=(
  # New features
  "add a" "add an" "add some" "add new"
  "implement" "build a" "build an" "create a" "create an"
  "new feature" "i need a" "i want a" "i need to"
  "develop a" "write a" "write an" "make a"
  "introduce" "set up" "set up a"

  # Bug fixes
  "fix" "bug" "broken" "not working" "doesn't work"
  "error" "issue with" "problem with" "something wrong"
  "fail" "failing" "failed" "crash" "crashed"

  # Refactoring
  "refactor" "rewrite" "restructure" "redesign"
  "optimize" "optimise" "improve" "clean up" "cleanup"
  "extract" "split" "merge" "reorganize" "reorganise"
)

# Issue 引用模式（如 LC-1234、PROJ-456、https://*.atlassian.net/browse/*）
# 这些通常出现在用户提及具体开发任务时
ISSUE_PATTERNS=(
  "[A-Z]+-[0-9]+"
  "atlassian.net/browse/"
)

# ── 配置：排除规则（匹配以下模式时不触发） ──────────────────────
# 这些是常见的非开发意图表达，即使包含开发关键词也不触发

EXCLUDE_PATTERNS=(
  # 纯查询/查看类（排除过于宽泛的词，仅保留明确非开发意图的短语）
  "查一下" "查查" "看看" "看一下"
  "读一下" "读读"
  "显示一下" "展示一下"

  # 文档/配置查询
  "怎么配置" "怎么设置" "怎么安装"
  "配置方法" "使用方法" "怎么用"
  "是什么意思" "的含义" "的定义"

  # 系统命令 / slash 命令（避免重复触发）
  "^/" "^opsx:" "^bmad" "^reef-"
  "^deepflow-" "^gstack" "^review" "^qa"
  "^ship" "^canary" "^retro" "^learn"
)

# ── 主逻辑 ────────────────────────────────────────────────────────

# 读取用户输入
MESSAGE="${CLAUDE_INPUT:-}"
[ -z "$MESSAGE" ] && exit 0

# 第一步：检查排除规则
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
  if echo "$MESSAGE" | grep -qiE "$pattern"; then
    exit 0  # 静默通过
  fi
done

# 第二步：匹配开发意图关键词（含 Issue 引用）
for pattern in "${ZH_DEV_PATTERNS[@]}" "${EN_DEV_PATTERNS[@]}" "${ISSUE_PATTERNS[@]}"; do
  if echo "$MESSAGE" | grep -qiE "$pattern"; then
    # 匹配成功 → 注入指令让 AI 调用 reef-start
    cat <<'HOOKEOF'
<system-reminder>
The user's message indicates a development task (feature request / bug fix / refactoring).
IMPORTANT: Before responding, you MUST invoke the reef-start skill using the Skill tool.
Pass the user's original message as context to the skill.
Only skip if reef-start is already active or you are already in a development flow.
</system-reminder>
HOOKEOF
    exit 0
  fi
done

# 未匹配 → 静默退出
exit 0
