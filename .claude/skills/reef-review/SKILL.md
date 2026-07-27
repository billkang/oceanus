---
name: reef-review
description: 对当前分支变更执行前后端代码审查。自动检测变更范围，派发 Sub‑Agent 执行审查并生成结构化报告。
allowed-tools: Bash(git:*), Agent
deepstorm:
  tool: reef
---

# 统一代码审查（Sub‑Agent 模式）

自动检测变更类别，派发对应 Sub‑Agent 执行审查。

## 工作流

### Step 1: 检测变更范围 + Eligibility 预检

```bash
# 获取 fork-point（检测当前分支基于哪个分支创建）
FORK_POINT=$(git merge-base "$(git reflog --date=local | grep "checkout: moving from.* to $(git rev-parse --abbrev-ref HEAD)$" | head -1 | sed -n 's/.*from \([^ ]*\) to .*/\1/p' || echo main)" HEAD)
echo "FORK_POINT=$FORK_POINT"
echo "变更文件统计:"
git diff "$FORK_POINT"..HEAD --stat

# 按类别提取文件清单
FILE_LIST=$(git diff "$FORK_POINT"..HEAD --name-only)
FILE_COUNT=$(echo "$FILE_LIST" | wc -l | tr -d ' ')
BACKEND_FILES=$(git diff "$FORK_POINT"..HEAD --name-only -- server/src/ server/test/)
FRONTEND_FILES=$(git diff "$FORK_POINT"..HEAD --name-only -- client/src/)
INFRA_FILES=$(git diff "$FORK_POINT"..HEAD --name-only | grep -v '^server/src/ server/test/' | grep -v '^client/src/')
SECURITY_FILES=$(git diff "$FORK_POINT"..HEAD --name-only -- server/src/ server/test/ client/src/ | grep -iE 'auth|tenant|security|oauth|token|password|permission' || true)

# Eligibility 预检：明显不需要审查的变更跳过派发
LOCK_ONLY=$(echo "$FILE_LIST" | grep -cE 'package-lock\.json|yarn\.lock|pnpm-lock\.yaml' || true)
DOCS_ONLY=$(echo "$FILE_LIST" | grep -vE 'package-lock\.json|yarn\.lock|pnpm-lock\.yaml' | grep -cE '\.md$|\.txt$|^docs/' || true)
if [ "$LOCK_ONLY" -gt 0 ] && [ "$(echo "$FILE_LIST" | wc -l | tr -d ' ')" -eq "$LOCK_ONLY" ]; then
  echo "ELIGIBLE=false"
  echo "REASON=仅 lock 文件变更，跳过代码审查"
fi
```

判断哪些类别有变更：

| 类别     | 判断条件              |
| -------- | --------------------- |
| 后端     | `BACKEND_FILES` 非空  |
| 前端     | `FRONTEND_FILES` 非空 |
| 基础配置 | `INFRA_FILES` 非空    |
| 安全敏感 | `SECURITY_FILES` 非空 |
| 无匹配   | 全部为空              |

据此决定派发哪些 agent（如果 ELIGIBLE=false 则不派发）：

| 有变更的类别     | 派发 agent                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| 仅后端           | `backend-code-audit`                                                   |
| 仅前端           | `frontend-code-audit`                                                  |
| 仅基础配置       | `infra-code-audit`                                                     |
| 后端 + 基础配置  | 并行 `backend-code-audit` + `infra-code-audit`                         |
| 前端 + 基础配置  | 并行 `frontend-code-audit` + `infra-code-audit`                        |
| 全栈             | 并行 `backend-code-audit` + `frontend-code-audit`                      |
| 全栈 + 基础配置  | 并行 `backend-code-audit` + `frontend-code-audit` + `infra-code-audit` |
| **安全敏感变更** | 在以上基础上 **额外** 并行 `security-code-audit`                       |
| 无匹配           | 输出提示，不派发 agent                                                 |

> 安全敏感变更判定：SECURITY_FILES 非空 或 变更涉及权限/认证逻辑（由调用的 fork-point 范围决定）。

### Step 2: 收集上下文 + 派发 Sub‑Agent

在派发前，收集 CLAUDE.md 和 git 上下文，透传给每个 agent：

```bash
# 收集根目录 CLAUDE.md 和变更文件夹下的 CLAUDE.md
CLAUDE_MD_FILES=$(echo "$FILE_LIST" | xargs -I{} dirname {} | sort -u | xargs -I{} sh -c '
  if [ -f "{}/CLAUDE.md" ]; then echo "{}/CLAUDE.md"; fi
' 2>/dev/null)
[ -f "CLAUDE.md" ] && CLAUDE_MD_FILES="CLAUDE.md $CLAUDE_MD_FILES"

# 收集 git blame 摘要（取前 5 个变更文件的 git log 历史）
GIT_HISTORY_SUMMARY=$(echo "$BACKEND_FILES $FRONTEND_FILES" | tr ' ' '\n' | sort -u | grep -v '^$' | head -5 | while IFS= read -r f; do
  echo "--- $f ---"
  git log --oneline -10 -- "$f" 2>/dev/null | head -5
done)

# 收集代码注释上下文（FIXME / HACK / WARNING 标注）
COMMENT_CONTEXT=$(echo "$BACKEND_FILES $FRONTEND_FILES" | tr ' ' '\n' | sort -u | grep -v '^$' | head -10 | while IFS= read -r f; do
  if [ -f "$f" ]; then
    matches=$(git diff "$FORK_POINT"..HEAD -- "$f" | grep -E '^\+' | grep -iE 'FIXME|HACK|WARNING|SECURITY|@audit|TODO' || true)
    [ -n "$matches" ] && echo "--- $f ---" && echo "$matches"
  fi
done)
```

每个 agent 的 prompt 构造为标准前缀 + 上下文数据 + false positive 规则：

```markdown
## 变更上下文

Fork point: {FORK_POINT}
变更文件数: {count}
变更文件清单:
{file_list}

## 相关规范文件（CLAUDE.md）

{CLAUDE_MD_FILES_content}

## Git 历史上下文

{GIT_HISTORY_SUMMARY}

## 代码注释标注

{COMMENT_CONTEXT}

## 不算 issues 的情况（不要误报）

- 已经有 lint/typecheck/CI 保障的问题（import 错误、类型错误、格式问题）
- 新增功能的测试覆盖率不足（非本变更范围）
- 变更前的已有问题（pre-existing issue），除非变更使之更严重
- NPM/Gradle 版本更新中的上游 breaking change
- 与模块内已有实现一致的新增代码（一致性值得保留，除非原实现就有 bug）
- 纯格式/空白/注释变更
```

| Agent                 | prompt 中的文件清单 |
| --------------------- | ------------------- |
| `backend-code-audit`  | 后端文件            |
| `frontend-code-audit` | 前端文件            |
| `infra-code-audit`    | 基础配置文件        |
| `security-code-audit` | 安全敏感文件        |

Agent 的 system prompt（定义在 `.claude/agents/` 目录中）包含完整的 Checklist + Rules + 输出格式。

| Agent                  | 定义文件                               |
| ---------------------- | -------------------------------------- |
| `reef-review-backend`  | `../../agents/reef-review-backend.md`  |
| `reef-review-frontend` | `../../agents/reef-review-frontend.md` |
| `reef-review-infra`    | `../../agents/reef-review-infra.md`    |
| `reef-review-security` | `../../agents/reef-review-security.md` |

多 agent 场景全部使用 `run_in_background: true` 并行执行。每个 agent 设置超时 300 秒（5 分钟），超时未返回则标记为超时，继续等待其他 agent。

### Step 3: 汇总报告（含证据链评分）

1. 等待所有已派发的 agent 返回（收到全部 task-notification 后才汇总）。任一 agent 超时 300 秒未返回则标记为超时，继续等待其他 agent
2. 聚合评分规则：
   - 若 Block 项附有证据链（🧾 `.md` / 📜 `git log` / 📝 `// comment` / 📚 `context7` / 🛠 `style-*`），保留原评级
   - 若 Block 项**无**证据链，降级为 Request Changes
   - 若 Request Changes 项无证据链，降级为 Suggestion
   - 确保报告不膨胀，每个 issue 一句话 + 一个链接
3. 分章节输出各 agent 的审查报告：

```
## 后端代码审查报告
{后端 agent 输出}

## 前端代码审查报告
{前端 agent 输出}

## 基础配置审查报告
{infra agent 输出}

## 安全审查报告
{security agent 输出（仅安全敏感变更时）}
```

4. 最终结论取最低评分。若某 agent 失败（API Error / 超时等），标注失败原因，忽略其评分。仅有派发过的 agent 输出对应章节。
