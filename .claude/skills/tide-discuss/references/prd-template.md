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

## 6. 验收标准

{pm 的 decisions 中属于验收标准的条目，编号 AC-1, AC-2...}

## 7. 技术方案

{如 architect 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 8. UX 设计建议

{如 designer 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 9. 发布策略

{如 po 角色已讨论完成，写入总结和决策；如未讨论则写"（未讨论）"}

## 10. 讨论记录

| 角色 | 完成时间 | 总结 |
|------|----------|------|
| {列出有 completedAt 的角色，跳过 skipped 的} | {时间} | {summary，前 50 字，不足则全量显示} |

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
    {"role": "analyst", "completedAt": "2026-06-11T10:15:00.000Z", "skipped": false},
    {"role": "pm", "completedAt": "2026-06-11T10:25:00.000Z", "skipped": false}
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
      {"id": "FR-1", "title": "支持企业微信扫码登录", "priority": "P0"},
      {"id": "FR-2", "title": "扫码授权页 UI", "priority": "P1"}
    ],
    "nonFunctionalRequirements": [
      "可用性: 需满足基本可用标准",
      "性能: 响应时间在可接受范围内"
    ],
    "acceptanceCriteria": [
      {"id": "AC-1", "description": "用户可通过企业微信扫码完成登录"},
      {"id": "AC-2", "description": "同一账号最多 3 台设备同时在线"}
    ],
    "technicalPlan": "（未讨论）",
    "uxSuggestions": "（未讨论）",
    "releaseStrategy": "（未讨论）"
  },
  "discussionRecords": [
    {"role": "analyst", "completedAt": "2026-06-11T10:15:00.000Z", "summary": "讨论了企业微信在企业通讯录中的使用情况..."}
  ],
  "openQuestions": [
    "需求范围是否有需要进一步明确的地方？",
    "所有关键决策是否已记录？"
  ]
}
```

**说明：**
- `sections` 中可选角色对应的字段（`technicalPlan` / `uxSuggestions` / `releaseStrategy`）如果角色未参与，值为 `"（未讨论）"`，与 Markdown 模板一致
- `participants` 包含所有已参与的角色（包括 `skipped: true` 的），不含未触及的角色
- 该 JSON 用于 4b 任务拆分的结构化读取，字段名固定不可随意修改
