# Brainstorming Session

- **日期**: 2026-08-01
- **Change**: `add-agent-turn-budget-limits`
- **状态**: ✅ 讨论完成

---

## 讨论主题

为 Oceanus 的 AI 调用增加**轮次上限（maxTurns）与单次预算硬顶（maxBudgetUsd）**管控能力，防止单次对话失控消耗成本。

## 关键决策

| #   | 决策                                                                                                  | 理由                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | 管控粒度 = **全局默认**（env 配置 `AGENT_MAX_TURNS` / `AGENT_MAX_BUDGET_USD`），不做会话级/用户级可配 | 现有 `maxTurns: 20` 即为全局硬编码，抽成配置成本最低；会话级配置需改数据模型，推迟                                      |
| 2   | 预算语义 = **单次硬顶**：SDK 原生 `maxBudgetUsd`，每次 `query()` 独立判定                             | SDK 直接支持，实现成本低；命中后 `error_max_budget_usd` 子类型可识别                                                    |
| 3   | `AGENT_MAX_TURNS` 默认 **15**                                                                         | 相比当前硬编码 20 更保守，与预算硬顶（$1.00）双保险；重文档生成轮次（8–12 次调用）也基本不被截断                        |
| 4   | `AGENT_MAX_BUDGET_USD` 默认 **1.00**（美元）                                                          | 20 轮 agent 会话 + thinking + 工具调用下，Sonnet-5 正常需求讨论通常 < $1；$1 可放行正常会话同时防失控（数值待最终确认） |
| 5   | 命中上限后**允许用户 resume 继续聊**，不标记会话终止                                                  | SDK 预算为单次 query 语义，resume = 新 query = 预算重新计，符合"继续讨论"心智                                           |
| 6   | SSE 事件**分开**：`TurnLimitReached` / `BudgetLimitReached`                                           | 前端可差异化提示（"已达轮次上限" vs "已达预算上限"）                                                                    |
| 7   | **不做成本落库/追踪/展示**                                                                            | `total_cost_usd` 为客户端估算值，追踪展示是独立需求，本轮只做"限制"能力                                                 |

## 需求要点

1. `.env.example` 新增 `AGENT_MAX_TURNS`（默认 15）、`AGENT_MAX_BUDGET_USD`（默认 1.00），含语义注释（注明客户端估算值、单次 query 独立判定）
2. `agent.service.ts`：硬编码 `maxTurns: 20` → `ConfigService` 读取；新增 `maxBudgetUsd`
3. `chat.service.ts`：捕获 result 的 `error_max_turns` / `error_max_budget_usd` 子类型 → 映射为对应 SSE 事件，替代当前裸错误（SDK throw 的原始错误串）
4. 前端：处理新 SSE 事件，展示友好提示
5. 文档同步：`docs/1-getting-started/`（env 配置）

## 边界范围（不做的）

- ❌ 不做累计预算（跨会话/项目累计、月度配额）
- ❌ 不做会话级/用户级可配置（粒度 B/C）
- ❌ 不做成本追踪/落库/用量面板（`total_cost_usd` 只读不入库）
- ❌ 不做向用户计费 / 余额管理
- ❌ 不做预算不足自动降级 / 切模型
- ❌ 不接线遗留的 `AGENT_MODEL` env（现有未使用项，另立 issue）
- ❌ 不改动 RequestQueue / KeyPool / Langfuse 现有行为

## 后续步骤

1. → **阶段三**：SDD 文档生成（proposal → specs → design → tasks）
2. → spec-hardener 审查
3. → writing-plans 实现计划
4. → 实现前门禁 + 风险路由 → TDD 实现
