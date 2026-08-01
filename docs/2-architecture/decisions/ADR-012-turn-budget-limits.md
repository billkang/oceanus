# ADR-012: 轮次与预算上限管控

- **日期**: 2026-08-01
- **状态**: 已接受
- **关联**: ADR-008（会话连续性）

## 背景

AI 调用硬编码 `maxTurns: 20` 且无成本上限，循环失控时单次调用成本不可控。

## 决策

1. 全局默认 env 配置 `AGENT_MAX_TURNS`（默认 15）/ `AGENT_MAX_BUDGET_USD`（默认 1.00），不做会话级/用户级可配
2. 预算语义为单次硬顶（SDK 原生 `maxBudgetUsd`），每次 query 独立判定；resume = 新 query = 重新计
3. 无效配置值一律回退默认，永不进入无限状态
4. 命中限额发专用 SSE 事件 `turn_limit_reached` / `budget_limit_reached`（data 携带 limit），流受控完成，会话保持 active
5. 限额命中跳过标题更新/PRD 提取与 `recordGeneration`，仍 `flushTrace`

## 权衡

- 默认值松紧依赖模型定价与工具调用密度，需按使用数据回调（env 一行可调）
- `total_cost_usd` 为客户端估算，非权威账单
- 不做累计预算、成本落库、计费（见 proposal Out of Scope）
