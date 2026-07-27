# PRD 模板

Step 3 生成 PRD 时使用的 Markdown 模板。

---

```markdown
---
title: {featureId} — PRD
status: 讨论完成
created: {日期}
updated: {日期}
featureId: {featureId}
---

# {featureId} — {brief}

> 通过 Tide BMAD 工作流自动生成 | 会话 ID: {sessionId}

## 1. 概述

**需求描述:** {brief}
**Feature ID:** `{featureId}`
**参与角色:**

- 📊 analyst — {summary 第一行}
- 📋 pm — {summary 第一行}
  （如 architect / designer / po 已参与，在此列出）

## 2. 背景与目标

{analyst 的 summary}

**关键决策:**

- {analyst 的 decisions，包含背景分析和约束假设}

**分析师需求（AR — Analyst Requirements）:**

- AR-1: {analyst requirements，按背景/约束/假设分类}
- AR-2: {analyst requirements}

## 3. 用户故事

{pm 的 requirements 中以"作为/我想/希望/用户"开头的条目}

## 4. 功能需求

{pm 的 requirements 中非用户故事的条目，编号 FR-1, FR-2...}

## 5. 非功能需求

- 可用性: 需满足基本可用标准
- 性能: 响应时间在可接受范围内
- 安全: 遵循数据安全和隐私保护规范

## 6. 行为场景（BDD）

{AI 从讨论中提取的场景化行为描述，遵循 Given-When-Then 格式}

### 正常流程

**S-1: {场景标题}**
```

Given {前置条件}
When {操作}
Then {预期结果}

```

{更多正常流程场景...}

### 异常流程

{至少包含一个异常场景，如超时、失败、权限不足等}

**S-2: {场景标题}**
```

Given {前置条件}
When {操作}
Then {预期结果}

```

{更多异常流程场景...}

### 边界场景（可选）

{数据极限、并发、特殊权限等边界条件场景}

> BDD 场景由 AI 在 Step 3 根据讨论内容自动生成，来源为 PM 的用户故事、边界讨论和 analyst 的痛点分析。每个场景必须来源于讨论中实际涉及的内容。

## 7. 验收标准

{pm 的 decisions 中属于验收标准的条目，编号 AC-1, AC-2...}

## 8. 技术方案

{如 architect 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 9. UX 设计建议

{如 designer 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 10. 发布策略

{如 po 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 11. 讨论记录

| 角色                                         | 完成时间 | 总结                                |
| -------------------------------------------- | -------- | ----------------------------------- |
| {列出有 completedAt 的角色，跳过 skipped 的} | {时间}   | {summary，前 50 字，不足则全量显示} |

## 11. 开放问题

- [ ] 需求范围是否有需要进一步明确的地方？
- [ ] 所有关键决策是否已记录？
- [ ] 验收标准是否覆盖了所有场景？
```

同时保存 JSON 快照到 `tide-data/prds/{sessionId}-prd.json`，格式如下：

```json
{
  "sessionId": "tide-20260611-001",
  "featureId": "AUTH-LOGIN-WECOM",
  "brief": "企业微信扫码登录",
  "generatedAt": "2026-06-11T10:30:00.000Z",
  "participants": [
    { "role": "analyst", "completedAt": "2026-06-11T10:15:00.000Z", "skipped": false },
    { "role": "pm", "completedAt": "2026-06-11T10:25:00.000Z", "skipped": false }
  ],
  "sections": {
    "background": {
      "summary": "企业微信在内部通讯中使用广泛，目前缺乏与企业微信集成的登录方式...",
      "decisions": ["使用扫码而非手动输入", "优先对接飞书而非企业微信"],
      "analystRequirements": ["AR-1: 支持企业微信扫码登录", "AR-2: 登录页面适配移动端"]
    },
    "userStories": [
      "作为企业微信用户，我想通过扫码快速登录，以便无需输入账号密码",
      "作为 IT 管理员，我想配置企业微信登录参数，以便控制接入权限"
    ],
    "functionalRequirements": [
      { "id": "FR-1", "title": "支持企业微信扫码登录", "priority": "P0" },
      { "id": "FR-2", "title": "扫码授权页 UI", "priority": "P1" }
    ],
    "nonFunctionalRequirements": ["可用性: 需满足基本可用标准", "性能: 响应时间在可接受范围内"],
    "scenarios": [
      {
        "id": "S-1",
        "title": "用户扫码登录成功",
        "category": "happy-path",
        "gherkin": "Given 用户已登录企业微信\nWhen 用户在登录页选择「企业微信登录」\nThen 页面展示二维码\nAnd 用户扫码后自动完成登录",
        "given": "用户已登录企业微信",
        "when": "用户在登录页选择「企业微信登录」",
        "then": "页面展示二维码，用户扫码后自动完成登录",
        "priority": "P0"
      },
      {
        "id": "S-2",
        "title": "二维码过期处理",
        "category": "error-flow",
        "gherkin": "Given 用户已打开扫码页面\nWhen 二维码超过 5 分钟未扫码\nThen 二维码自动刷新\nAnd 页面提示「二维码已刷新」",
        "given": "用户已打开扫码页面",
        "when": "二维码超过 5 分钟未扫码",
        "then": "二维码自动刷新，页面提示「二维码已刷新」",
        "priority": "P1"
      }
    ],
    "acceptanceCriteria": [
      { "id": "AC-1", "description": "用户可通过企业微信扫码完成登录" },
      { "id": "AC-2", "description": "同一账号最多 3 台设备同时在线" }
    ],
    "technicalPlan": "（未讨论）",
    "uxSuggestions": "（未讨论）",
    "releaseStrategy": "（未讨论）"
  },
  "discussionRecords": [
    {
      "role": "analyst",
      "completedAt": "2026-06-11T10:15:00.000Z",
      "summary": "讨论了企业微信在企业通讯录中的使用情况..."
    }
  ],
  "openQuestions": ["需求范围是否有需要进一步明确的地方？", "所有关键决策是否已记录？"]
}
```

**说明：**

- `sections` 中可选角色对应的字段（`technicalPlan` / `uxSuggestions` / `releaseStrategy`）如果角色未参与，值为 `"（未讨论）"`，与 Markdown 模板一致
- `participants` 包含所有已参与的角色（包括 `skipped: true` 的），不含未触及的角色
- `scenarios` 由 AI 在 Step 3 根据讨论内容自动生成，提供结构化的 BDD 场景供下游消费
- 该 JSON 用于下游流程的结构化读取（tide-publish 发布、OpenSpec `/opsx:new` 消费），字段名固定不可随意修改
- 旧版仅含 `acceptanceCriteria` 的 JSON 仍被支持，读取时降级
