# Tasks: 轮次与预算上限管控

## 1. SSE 事件类型定义（后端）

- [x] 1.1 `server/src/agent/types/sse-events.ts` 新增 `TurnLimitReached = 'turn_limit_reached'` / `BudgetLimitReached = 'budget_limit_reached'` 枚举值
- [x] 1.2 `server/src/agent/types/sse-events.ts` 新增 `SseTurnLimitReached` / `SseBudgetLimitReached` 事件接口（data: `{ limit: number }`），加入 `SseEvent` 联合

## 2. 后端配置解析与注入

- [x] 2.1 `agent.service.ts` 新增私有 `parseLimit(raw, fallback)` / `resolveAgentLimits()` helper（空 / 非数字 / 0 / 负数一律回退默认 15 / 1.00）
- [x] 2.2 `agent.service.ts` query options 用 `resolveAgentLimits()` 替换硬编码 `maxTurns: 20`，并新增 `maxBudgetUsd` 选项
- [x] 2.3 `agent.service.ts` 新增公开 `getAgentLimits()`（复用 `resolveAgentLimits()`，供 chat.service 取 limit 值）
- [x] 2.4 `server/.env.example` 的 `# ── Claude Agent SDK ──` 段新增 `AGENT_MAX_TURNS=15` / `AGENT_MAX_BUDGET_USD=1.00`，含语义注释（单次 query 独立判定、无效值回退默认）

## 3. 后端限额命中处理

- [x] 3.1 `chat.service.ts` 循环内新增 result 限额错误分支：subtype 为 `error_max_turns` / `error_max_budget_usd` 时，调用 `agentService.getAgentLimits()` 取 limit → 发对应 SSE 事件 → sessionLog 记录 → 置 `limitHit` → break
- [x] 3.2 `chat.service.ts` post-loop 按 `limitHit` 跳过 `recordGeneration` 与 `afterStreamComplete`；仍 `flushTrace`、发 `stream_complete`
- [x] 3.3 `chat.service.ts` catch 块按 `limitHit` 防御性抑制通用 `error` 事件（避免双事件）

## 4. 前端

- [x] 4.1 `client/src/app/chat/chat.service.ts` 镜像 `SseEventType` 枚举新增 `TurnLimitReached` / `BudgetLimitReached`
- [x] 4.2 `client/src/app/chat/chat.component.ts` `handleSseEvent` 新增 2 个 case：设置 `limitNotice` 信号（文案含 limit 值，如"已达到本次轮次上限（15 轮），你可以继续发送消息"）
- [x] 4.3 `client/src/app/chat/chat.component.html` 渲染 `limitNotice` 内联横幅；输入框保持可用、会话不关闭，下次发送时清空横幅

## 5. 文档同步

- [x] 5.1 `docs/1-getting-started/` 更新 env 配置说明（AGENT_MAX_TURNS / AGENT_MAX_BUDGET_USD）
- [x] 5.2 新增 `docs/2-architecture/decisions/ADR-012-turn-budget-limits.md`（记录 D1–D5 决策）
