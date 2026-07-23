# 阶段四 — 实现细节

> 内容从 SKILL.md.tmpl 阶段四提取，按需读取。流程图和核心原则保留在 SKILL.md.tmpl 中。

## 4.1 准备工作

**Path A：**

```bash
CHANGE=$(git branch --show-current)
PLAN_FILE="docs/superpowers/plans/$(date +%Y-%m-%d)-$CHANGE.md"
```

**Path B：** 超powers 门禁通过后，**先创建 git 分支**，再进入 TDD 循环：

```bash
# 获取 change 名
CHANGE=$(ls openspec/changes/ | sort -r | head -1)
# 创建分支
git stash push -m "reef-start-auto-stash" 2>/dev/null || true
git checkout main && git fetch origin main && git reset --hard origin/main
git checkout -b "$CHANGE"
git stash pop 2>/dev/null || true
# 记录计划文件路径
PLAN_FILE="docs/superpowers/plans/$(date +%Y-%m-%d)-$CHANGE.md"
```

如果 `$PLAN_FILE` 存在，读取实现计划，按 plan 中的 task 分解顺序逐 task 实现。计划中的每个 task 已包含完整的文件路径、测试代码、实现代码和提交步骤。

## 4.2 逐 task 实现（按 mode 选择执行路径）

根据风险路由确定的 mode，选择对应的实现路径。

### 🟢 Plan Mode 路径（直接实现 + 后置验证）

适用于：文档修改、配置文件调整、SKILL.md 流程修改、测试框架搭建、简单重构（测试覆盖充分）

```
1. 🔴 确认 code-style 已加载 — 检查 `reef:reef-style-backend` 或 `reef:reef-style-frontend` 是否已通过 Skill tool 加载
   - 已加载 → 进入步骤 2
   - 未加载 → 暂停并先通过 Skill tool 加载对应技能，阅读 quick-reference.md 后再继续
2. 直接实现代码变更
3. 执行后置验证：build → lint → test
4. 如果验证失败 → 修复 → 重新验证 → 通过后才标完成
5. 如果发现复杂度超预期 → 暂停并向用户建议升级为 tdd mode
6. ✅ 标记 task 为完成
```

> **⚠️ Plan mode 风险预警：** plan mode 不要求前置测试，但**后置验证不可跳过**。如果 build/lint/test 任何一步失败，该 task **不得**被标记为完成。

### 🔴 TDD Mode 路径（完整 RED → GREEN → REFACTOR）

适用于：新增业务逻辑、Bug 修复、权限/安全变更、资金/幂等性变更、状态机/并发逻辑

**🔴 RED — 先写测试**
- 先确认 code-style 已加载：检查 `reef:reef-style-backend` 或 `reef:reef-style-frontend` 是否已通过 Skill tool 加载，未加载则先加载
- 根据 spec 的 Scenario 编写单元测试
- 运行测试，确认失败（红）
- 如果测试意外通过了，说明测试写的太弱，需改进
- **不写实现代码**

**🟢 GREEN — 最小实现**
- 只写让当前测试通过的最小代码量
- 不提前实现未测试的功能
- 运行测试，确认全绿
- 如果感觉"这段代码还没写完"，那是正常的 — 下一个 task 会覆盖

**🔵 REFACTOR — 保持测试通过的前提下重构**
- 清理重复代码、提取函数、重命名
- 保持测试运行通过
- 不改变行为

### 后置验证门禁（每个 task 完成前强制执行）

无论 plan mode 还是 tdd mode，每个 task 标记为 ✅ 完成前，**必须先通过以下三步验证**。任何一步失败，该 task **不得**被标记为完成。

```
Step 1: Build 验证
  └─ 执行构建命令（参见下方框架自适应命令表）
  └─ 通过 → 进入 Step 2
  └─ 失败 → 输出错误信息 → 修复 → 重新验证

Step 2: Lint 验证
  └─ 执行 lint 命令
  └─ 通过 → 进入 Step 3
  └─ 失败 → 自动修复可修复问题 → 剩余问题输出供人工处理 → 重新验证

Step 3: Test 验证
  └─ 执行测试命令（关联用例，tdd mode 跑完整套件）
  └─ 通过 → ✅ 标记完成
  └─ 失败 → 输出失败用例详情 → 修复 → 重新验证
```

> **⚠️ 验证门禁是硬性要求，不可跳过。** 即使变更看起来"很简单"，也必须跑过 build + lint + test。跳过验证等同于跳过质量门禁。

### 框架自适应验证命令

根据项目技术栈自动选择对应命令。无法推断时询问用户，并将结果写入 task 笔记复用。

| 框架 | Build | Lint | Test |
|------|-------|------|------|
| Java Spring Boot | `mvn compile` | `mvn checkstyle:check` 或 `mvn validate` | `mvn test` |
| Python FastAPI | `pip install -e .` dry-run 或 `poetry install --dry-run` | `ruff check .` 或 `pylint` | `pytest` |
| Node.js / TypeScript | `npm run build` 或 `pnpm build` | `npm run lint` 或 `pnpm lint` | `npm test` 或 `pnpm test -- --related`（仅关联用例） |
| Go | `go build ./...` | `golint` 或 `go vet` | `go test ./...` |
| 无法推断 | 询问用户当前可用的验证命令 | 同左 | 同左 |

### 完成一个 task 后

1. 标记 tasks.md 中对应项为 `- [x]`
2. 如 `$PLAN_FILE` 存在，同步标记 plan 中对应步骤为 `- [x]`
3. 运行完整测试套件确认没有回归
4. 进入下一个 task（参照 plan 中的步骤顺序）
5. 如遇到阻塞或模糊需求，暂停并询问用户

## 4.3 全部任务完成后的 code-audit

加载 `reef:reef-review` skill。检测变更范围，并行派发 agent。

### code-audit 检查清单（含 AC-to-test 回溯）

- [ ] 变更范围是否覆盖了全部 task
- [ ] 命名、目录结构、代码风格与项目一致
- [ ] **AC-to-test 回溯** — 每个 AC (Acceptance Criteria) 已被至少一个测试方法覆盖
  - 逐条检查 spec.md 中的每个 Acceptance Criteria
  - 标记每条 AC 对应的测试文件 + 方法名
  - 输出 AC Coverage 表格：

  ```
  AC Coverage: 4/5
  ├── AC-1 ✅ UserRegistrationTest::testCreateSuccess
  ├── AC-2 ✅ UserRegistrationTest::testDuplicateEmail
  ├── AC-3 ✅ UserRegistrationTest::testPasswordPolicy
  ├── AC-4 ✅ UserRegistrationIntegrationTest::testEndToEnd
  └── AC-5 ❌ （未找到匹配测试）
  ```

  - **高风险 AC 遗漏**（涉及权限/安全/资金/幂等）：要求补测，补充后重新验证
  - **低风险 AC 遗漏**（UI 文案变更/日志调整等）：可豁免，但记录到 verify-report

- [ ] 无遗留的 `TBD`、`TODO`、`FIXME` 占位符（合理的 FIXME 除外）
- [ ] 后置验证门禁通过（build + lint + test 全绿）

全部通过后执行 `openspec sync --change "$CHANGE"`。

## 4.4 生成验证报告

code-audit 通过后、分支结束前，生成统一的结构化验证报告，收敛本次 change 的所有验证证据。

**报告路径：**

```bash
VERIFY_REPORT="openspec/changes/$CHANGE/verify-report.json"
```

**报告格式：**

```json
{
  "change": "$CHANGE",
  "tasks": { "total": 17, "passed": 17 },
  "build": { "command": "npm run build", "exitCode": 0, "passed": true, "duration": 8 },
  "lint": { "command": "npm run lint", "exitCode": 0, "passed": true },
  "tests": { "command": "npm test", "exitCode": 0, "passed": true, "total": 42, "passed": 42, "failed": 0, "duration": 15 },
  "acCoverage": { "total": 5, "covered": 4, "uncovered": ["AC-5: ..."] },
  "review": { "findings": 3, "blockers": 0, "warnings": 2, "suggestions": 1, "reportPath": "..." },
  "summary": "PASSED"
}
```

**摘要字段取值：**
- `PASSED` — 所有检查通过
- `PASSED with warnings` — 有 warning 但无 blocker
- `FAILED` — 存在 blocker 或测试失败

**汇总逻辑：**

| 数据来源 | 对应字段 | 说明 |
|---------|---------|------|
| tasks.md | `tasks` | 已完成的 task 数 / 总 task 数 |
| 后置验证 build | `build` | build 命令、退出码、耗时 |
| 后置验证 lint | `lint` | lint 命令、退出码 |
| 后置验证 test | `tests` | 测试命令、总数/通过/失败 |
| AC-to-test 回溯 | `acCoverage` | AC 覆盖总数/已覆盖/未覆盖列表 |
| code-audit 结果 | `review` | findings 统计 + 报告路径 |

写入后向用户摘要报告关键数据，用户确认后再进入分支结束处理。

## 4.5 分支结束处理

询问用户：**创建提交 / 创建 PR / 保留分支 / 丢弃分支**

| 操作 | 说明 |
|------|------|
| 创建提交 | 中文 message + Issue URL（Path A 有则加，Path B 可选）+ PRD 链接（如有），verify-report.json 随 change 目录归档 |
| 创建 PR | `git push -u origin "$CHANGE"` → `gh pr create`，verify-report.json 随 change 目录移入 `openspec/changes/archive/` |
| 保留分支 | 报告分支名和变更位置 |
| 丢弃分支 | 用户确认后删除 |
