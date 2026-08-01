# Proposal: 轮次与预算上限管控

## Why

Oceanus 当前的 AI 调用在 `agent.service.ts` 中硬编码 `maxTurns: 20`，且完全不设成本上限。需求讨论会话由 agent 自主执行多轮工具调用，一旦循环失控（如技能误触发、长循环），API 成本可能不可控。系统需要具备**轮次上限与单次预算硬顶**能力，让单次调用成本可预期、可管控。

## What Changes

- 新增全局 env 配置 `AGENT_MAX_TURNS`（默认 `15`）、`AGENT_MAX_BUDGET_USD`（默认 `1.00`）
- `AgentService.query()` 的 `maxTurns` 从硬编码改为读取配置，并新增 `maxBudgetUsd` 选项（单次 query 硬顶）
- 命中 `error_max_turns` / `error_max_budget_usd` 结果时，不再向用户暴露 SDK 原始错误串，改为映射为明确的 SSE 事件 `turn_limit_reached` / `budget_limit_reached`
- 前端新增对两个 SSE 事件的友好提示文案
- 命中上限后会话状态保持 `active`，用户可继续 resume 聊天（预算按单次 query 重新计）

## Capabilities

### New Capabilities

- `agent-budget-limits`: 轮次与预算上限的全局配置、SDK 选项注入、限额命中通知（SSE 事件）与前端提示

### Modified Capabilities

- `agent-integration`: `oceanus-tide` Agent 初始化配置由硬编码 `maxTurns: 20` 改为 env 驱动，并新增 `maxBudgetUsd` 选项

## Impact

- **后端**：`server/src/agent/agent.service.ts`（query 选项注入）、`server/src/chat/chat.service.ts`（result 子类型处理）
- **SSE 协议**：`server/src/agent/types/sse-events.ts`（新增 2 个事件类型）
- **前端**：`client/src` 聊天组件 SSE 事件处理
- **配置**：`server/.env.example`（新增 2 项）、`server/.env`（本地）
- **文档**：`docs/1-getting-started/`（env 配置说明）、`docs/2-architecture/decisions/`（新增 ADR）

## Out of Scope

- ❌ **累计预算**：跨会话 / 跨项目累计、月度配额（permanent out，本轮仅单次硬顶）
- ❌ **会话级 / 用户级可配置**：粒度 A 全局默认，不做 per-session / per-user 配置（v2 视需求）
- ❌ **成本追踪 / 落库 / 用量面板**：`total_cost_usd` 为客户端估算值，只读不入库（v2 另立需求）
- ❌ **计费 / 余额管理**：不做向用户计费或余额扣减
- ❌ **预算不足自动降级**：不做自动切模型 / 降级响应
- ❌ **接线遗留 `AGENT_MODEL` env**：现有未使用项，另立 issue 处理
- ❌ **改动 RequestQueue / KeyPool / Langfuse 现有行为**：仅新增上限选项与事件，不重构既有链路

## Known Limitations

- **默认 15 轮 / $1.00 的松紧依赖模型定价与工具调用密度**：定价变化或复杂需求变多时可能频繁触顶，需按真实使用数据回调；env 一行可调。
- **预算为客户端估算值，非权威账单**：`total_cost_usd` 是 SDK 侧估算，实际账单可能略超 $1.00；此闸防的是"失控循环"而非精确计费。
- **全局默认无法按会话 / 团队差异化调优**：特定类型会话频繁触顶时，只能改全局 env，不能针对单会话放宽。
- **前端横幅不持久**：限额提示仅当次显示、下次发送即清空，用户可能错过理解"本次响应被截断"的原因。
