# Superpowers 门闸 — 声明模板、检查清单与 Red Flags

> 内容从 SKILL.md.tmpl 阶段三→四门闸段提取（风险路由判断完成后使用），按需读取。

## Plan Mode 声明模板

```
## ✅ Superpowers 门闸通过 — 🟢 Plan Mode

### 风险路由

计划按 plan mode（直接实现 + 后置验证）执行本变更。

### 已加载的技能

| 技能 | 类型 | 对本变更的要求 |
|------|------|---------------|
| {skill-name} | {类型} | {要求描述} |
| `reef:reef-style-backend` / `reef:reef-style-frontend` | 🟢 **Code Style** | 所有新增/修改的代码必须遵循项目编码规范，加载后阅读 `quick-reference.md` 和必要维度规范 |

### Plan Mode 纪律确认

进入实现前，以下纪律将覆盖默认实现流程：
- **直接实现，再后置验证** — 不要求前置测试，但 build + lint + test 必须全部通过
- **复杂度超预期时主动升级** — 发现多模块联动、边界条件复杂时暂停并建议升级 tdd
- 配置文件、SKILL.md 模板、markdown 文件豁免后置验证（但建议检查）
```

## TDD Mode 声明模板

```
## ✅ Superpowers 门闸通过 — 🔴 TDD Mode

### 风险路由

计划按 tdd mode（完整 RED→GREEN→REFACTOR）执行本变更。

### 已加载的技能

| 技能 | 类型 | 对本变更的要求 |
|------|------|---------------|
| test-driven-development | 🔴 **Rigid** | 每个代码行为改动必须先写测试、看失败、再写实现 |
| `reef:reef-style-backend` / `reef:reef-style-frontend` | 🟢 **Code Style** | 所有新增/修改的代码必须遵循项目编码规范，加载后阅读 `quick-reference.md` 和必要维度规范 |

### TDD 纪律确认

进入实现前，以下 rigid 纪律将覆盖默认实现流程：
- `test-driven-development` 的铁律：**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**
- 配置文件、SKILL.md 模板、markdown 文件豁免 TDD
- **tdd → plan 禁止降级** — 不得以变更简单为由跳过测试
```

## 安全检查清单（增强版）

- [ ] proposal.md 已生成并通过 spec-hardener
- [ ] specs/ 已生成并通过 spec-hardener
- [ ] design.md 已生成
- [ ] tasks.md 已生成
- [ ] 📝 **实现计划已生成**（superpowers:writing-plans 完成，存于 `docs/superpowers/plans/`）
- [ ] 用户已审阅并批准所有 SDD 文档及实现计划
- [ ] 🔍 **Superpowers 技能已加载**（Skill 工具已调用）
- [ ] 🎨 **Code-Style 技能已加载**（`reef:reef-style-backend`/`reef:reef-style-frontend` 已通过 Skill 工具加载并阅读规范）
- [ ] 🚨 **Rigid 纪律已向用户声明并获得确认**
- [ ] Path A 检查项：Git 分支已从 main 岔出
- [ ] Path B 检查项：OpenSpec change 已创建，brainstorming 文件已产出

## Red Flags

> 以下每一个想法都是一个危险信号。**任何一个出现 → 立即停止 → 回到本步骤执行 superpowers 检查。**

| 想法 | 现实 |
|------|------|
| "tasks + plan 都完成了，直接实现吧" | ❌ 必须先走完 3.8 语言规范 → 3.9 用户确认 → Superpowers 门禁。plan 生成 ≠ 可以跳过后续步骤。 |
| "tasks 完成了，直接进入实现吧" | ❌ 必须先检查 superpowers。顺序不可颠倒。 |
| "这个变更很简单，不需要检查" | 只要有 1% 的可能性适用，就**必须**检查。 |
| "我知道 TDD 是什么，不用加载技能" | 技能会更新。加载当前版本才有效。 |
| "先搞快点，后面再补测试" | 补 = 不补。不可协商的纪律。 |
| "子代理一次性写代码效率高，TDD 太慢" | TDD 铁律优先于效率。质量不可妥协。 |
| "已经改了代码，回头补测试也一样" | 测试-after 和 TDD 不等价。测试-after 验证的是"代码做了什么"，不是"代码应该做什么"。 |
