---
name: reef-commit
description: 根据当前变更和 OpenSpec 上下文，生成规范的提交信息并创建新提交。用户说「提交代码」「commit」「git push」「提交」「推送」等触发
allowed-tools: Bash(git:*), Bash(./gradlew:*), Bash(pnpm:*)
deepstorm:
  tool: reef
---

# 智能生成提交信息

根据当前变更、OpenSpec 任务定义及仓库历史 PR 风格，生成中文提交信息，创建新的 git 提交。

## 提交信息风格规范（基于历史 PR 总结）

### 标题

1. 不使用 conventional commit 前缀（无 `feat:`、`fix:`、`chore:` 等）
2. 一句话说清做了什么，可含英文术语
3. 命名来源优先级：OpenSpec proposal/design 标题 → 分支名语义化 → 变更内容总结
4. 每行 ≤ 70 字符

### 正文（根据任务复杂度决定）

| 复杂度 | 正文策略 |
|--------|---------|
| 简单（单文件/小修补/配置改动） | 仅标题 |
| 中等 | 标题 + 一段说明 |
| 复杂（多模块/架构级/前后端/破坏性变更） | 标题 + `本次提交改动如下：` + 要点列表 |

有参考文档加 `参考资料：`，关联 Issue 在尾部隔空行加 `JIRA: {完整 URL}`。文件数仅作参考（50 个重命名仍属简单）。

## 工作流

### 1. 检测变更

```bash
git status --short
```

若无任何变更则提示用户并退出。

### 2. 分支名与任务相关性检查

通过 `branch-check.mjs` 检查当前分支是否合法：

```bash
node packages/reef/skills/reef-commit/scripts/branch-check.mjs
```

输出 JSON：
```json
{"isValid":true,"warning":false,"action":"continue"}
```

**判断规则：**
- `isValid: false, action: "create-branch"`（当前在 main/master）→ **直接进入步骤 3**
- `warning: true, action: "suggest-rename"`（分支名像临时分支）→ 询问用户是否改名
- `matchedTask` 有值 → 说明已匹配到 OpenSpec 任务
- 其他 → 直接继续

### 3. 创建新分支

按以下逻辑确定分支名（优先级从高到低）：
1. **OpenSpec 任务名**：由 `branch-check.mjs` 输出的 `matchedTask` 确定
2. **用户输入**：询问用户想要的分支名
3. **AI 推导**：根据变更内容总结生成 kebab-case 分支名

```bash
bash packages/reef/skills/reef-commit/scripts/stash-and-switch.sh <new-branch-name>
```

> **注意**：创建新分支后，后续步骤（审查文件、范围检查、测试等）在新分支上继续执行。

### 4. 审查待提交文件

展示变更清单，检查敏感文件：

```bash
git diff --stat
```

如包含 `.env`、凭据、证书或大型二进制文件，让用户确认或排除后再继续。

### 5. 分支范围检查

检查当前分支是否涉及多个业务领域。如果跨领域，给出拆分建议并中止提交。

```bash
SCOPE_HOOK="packages/reef/hooks/reef-scope-gate.sh"
if [ -f "$SCOPE_HOOK" ]; then
  bash "$SCOPE_HOOK" || {
    echo ""
    echo "提示：如需继续提交，请使用 'reef-scope-split.sh' 拆分分支"
    echo "或临时禁用 scope 检查（不推荐）：settings.json → reef.scope.enabled: false"
    exit 1
  }
fi
```

### 6. 运行单元测试

```bash
bash packages/reef/skills/reef-commit/scripts/run-tests.sh --json
```

- 全部通过（`allPassed: true`）→ 继续
- 任一测试失败（`allPassed: false`）→ 提示用户修复后再提交

### 6.5 OpenSpec 验证与归档检查

> 提交前检查关联的 OpenSpec change 是否已完成验证和归档。如果 `openspec/` 目录不存在或无活跃 change 则跳过本步骤。

**判断流程：**

1. **查找关联的 OpenSpec change：**
   ```bash
   node packages/reef/skills/reef-commit/scripts/check-openspec-status.mjs \
     --branch "$(git branch --show-current)"
   ```

2. **匹配规则：** 脚本输出中 `name` 匹配当前分支名，`tasksAllDone` 检查任务完成状态。
3. **检查归档状态：** 无输出（`noMatch: true`）→ 跳过。`hasTasksMd: true` + `tasksAllDone: true` → 已全部完成 → 调用 `/opsx:verify` 和 `/opsx:archive`。
4. **运行验证：** 确认后通过 Skill 工具自动调用 `/opsx:verify`。有 CRITICAL 问题则中止；仅 WARNING/SUGGESTION 则通过。
5. **运行归档：** 验证通过后 → 通过 Skill 工具自动调用 `/opsx:archive`。执行失败则提示用户手动处理。

### 7. 收集上下文

```bash
node packages/reef/skills/reef-commit/scripts/collect-git-context.mjs
```

输出 JSON 包含 `branch`、`diffStat`、`commitLog`、`openspecChanges` 等字段。提取 `openspecChanges` 中 `matched: true` 项的 `proposal.md` 标题作为提交信息素材。

### 8. 生成提交信息

**标题：** 优先 OpenSpec proposal 标题 → 分支名（kebab-case 转中文）→ 变更总结。依赖更新用 `更新 {依赖} 至 {版本}`，问题修复用 `解决{问题描述}的问题`。

**正文：** 中/复杂变更用 `本次提交改动如下：` + 3-6 条要点。尾部隔空行加 `JIRA: {完整 URL}`（优先从 proposal.md/jira-start 元数据中获取 JIRA 链接），如有 PRD 链接加 `Ref: {URL}`。

### 9. 展示并确认

展示完整提交信息，用户确认即可提交；支持 `--amend` 合并；用户可要求修改后重新生成。

### 10. 执行提交

```bash
git add -A && git commit -m "<完整提交信息>"
# 用户要求 amend 时: git commit --amend -m "<完整提交信息>"
```

### 11. 推送（仅在用户要求时）

```bash
# 新提交（有远程跟踪）：git push
# Amend：git push --force-with-lease
# 首次推送：git push -u origin $(git branch --show-current)
```

## 约束规则

默认新提交，用户要求才 `--amend`。每行 ≤ 70 字符。无变更则退出。
