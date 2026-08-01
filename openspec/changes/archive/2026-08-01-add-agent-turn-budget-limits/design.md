# Design: 轮次与预算上限管控

## Context

Oceanus 的 AI 调用在 `server/src/agent/agent.service.ts` 中硬编码 `maxTurns: 20`，且不设任何成本上限。需求讨论会话由 `oceanus-tide` Agent 自主执行多轮工具调用，一旦循环失控（技能误触发、长循环），单次调用成本不可控。

- **现状**：`agent.service.ts:110` 硬编码 `maxTurns: 20`；`chat.service.ts:187` 只处理 result subtype `success`，其他结果子类型（含 `error_max_turns` / `error_max_budget_usd`）落到 catch → 通用 `error` SSE 事件（展示 SDK 原始错误串）。
- **SDK 事实**（v0.3.218）：单次 `query()` 命中限额时，先 yield `SDKResultError`（subtype 区分 `error_max_turns` / `error_max_budget_usd`，携带 `num_turns` / `total_cost_usd` / `errors`，**不携带配置的 limit 值**），随后 throw。`maxTurns` / `maxBudgetUsd` 均为单次 query 独立判定，resume = 新 query = 重新计。
- **约束**：不落库成本数据、不改数据模型、会话保持 `active`。

## Goals / Non-Goals

**Goals:**

- 单次 query 的轮次上限与预算硬顶可配置（全局默认，env 驱动）
- 命中限额时以明确 SSE 事件通知，而非 SDK 原始错误串
- 限额命中后流"受控完成"：会话保持 `active`，用户可 resume 继续聊
- 限额命中可观测（sessionLog + Langfuse flush），不记录残缺数据

**Non-Goals:**

- 不落库 / 追踪 / 展示成本数据（`total_cost_usd` 为客户端估算值，只读）
- 不做会话级 / 用户级可配置（粒度 A 全局默认）
- 不做累计预算（跨会话 / 项目 / 月度配额）
- 不做计费 / 余额管理 / 预算不足自动降级
- 不接线遗留的 `AGENT_MODEL` env（既有债，另立 issue）

## Decisions

### D1: 配置解析与回退（无效值一律回退默认）

`AgentService` 内私有 helper，每次 `query()` 调用时读取，任何"无效值"回退默认（15 / 1.00），**永不进入无限状态**：

```typescript
private parseLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

private resolveAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
  const maxTurns = this.parseLimit(this.configService.get<string>('AGENT_MAX_TURNS'), 15);
  const maxBudgetUsd = this.parseLimit(this.configService.get<string>('AGENT_MAX_BUDGET_USD'), 1.0);
  return { maxTurns, maxBudgetUsd };
}
```

> 默认值依据：`15` 轮可容纳单条消息的重文档生成（读文件 + 多文件写入 + 校验约 8–12 次工具调用）而基本不被截断；`$1.00` 基于 Sonnet-5 单条 agent 轮询成本估算（约 $0.3–0.9）取整，放行正常讨论同时防失控。两者均可经 env 回调。
>
> 替代方案（被否）：Joi 启动校验 — 引入新依赖 + 改变启动行为，仅一个参数回退不值得；空/非数字/0 由 helper 兜底即可。

### D2: limit 值来源（AgentService 公开 getter，避免逻辑重复）

`SDKResultError` 不携带配置的 limit 值，而检测子类型的是 `chat.service.ts`（它不持有配置解析逻辑）。让 `AgentService` 公开解析结果：

```typescript
getAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
  return this.resolveAgentLimits();
}
```

`chat.service.ts` 命中限额时按 subtype 取对应 limit 填入事件 data。

> 替代方案（被否）：`chat.service.ts` 直接注入 `ConfigService` 重复解析逻辑 — 两处维护易漂移。

### D3: 限额检测位置与受控完成

在 `chat.service.ts` 的 `for await` 循环内，对 `msg.type === 'result'` 且 subtype 为限额错误时：

1. 发 `turn_limit_reached` / `budget_limit_reached` SSE 事件（data 携带 limit）
2. sessionLog 记录限额命中（含 limit 值）
3. 置 `limitHit: 'turns' | 'budget'`，`break` 退出循环

循环后按 `limitHit` 分支：

- 跳过 `recordGeneration`（无完整 generation）与 `afterStreamComplete`（标题 / PRD 提取）
- 仍执行 `flushTrace`（已生成 thinking / tool 数据不丢）
- 正常发 `stream_complete` 关闭流

catch 块**防御性抑制**：若 `limitHit` 已置位，跳过通用 `error` 事件（覆盖 SDK 在 break 前 throw 的路径，避免双事件）。

> 设计要点：`break` 退出 for-await 通常不触发 SDK throw（迭代器 return() 不抛），因此主路径是"break → post-loop → 正常关闭"；catch 抑制是兜底，确保任何路径下用户只收到一个限额事件。

### D4: SSE 事件契约

沿用现有 snake_case 枚举 + 带 data 接口 + 加入 `SseEvent` 联合的模式：

```typescript
TurnLimitReached = 'turn_limit_reached',      // data: { limit: number }
BudgetLimitReached = 'budget_limit_reached',  // data: { limit: number }
```

单位由事件类型区分（turns 为整数、usd 为浮点），前端按类型渲染单位。

### D5: 前端提示

`handleSseEvent` 新增两个 case → 设置 `limitNotice` 信号（内联横幅文案，含 limit 值）；输入框保持可用、会话不关闭。横幅随下一次发送清空。

## Change Scope Matrix

| 文件                                                          | 变更类型 | 变更内容                                                                                                                                                          |
| ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/agent/agent.service.ts`                           | 修改     | `maxTurns: 20` 硬编码 → `resolveAgentLimits()` + `parseLimit()`；query options 新增 `maxBudgetUsd`；新增公开 `getAgentLimits()`                                   |
| `server/src/chat/chat.service.ts`                             | 修改     | 循环内新增 result 限额错误分支（发事件 + 置 `limitHit` + break）；post-loop 按 flag 跳过 `recordGeneration` / `afterStreamComplete`；catch 按 flag 抑制通用 error |
| `server/src/agent/types/sse-events.ts`                        | 修改     | 新增枚举值 + 2 个事件接口 + 加入 `SseEvent` 联合                                                                                                                  |
| `server/.env.example`                                         | 修改     | `# ── Claude Agent SDK ──` 段新增 `AGENT_MAX_TURNS=15`、`AGENT_MAX_BUDGET_USD=1.00` 及语义注释                                                                    |
| `client/src/app/chat/chat.service.ts`                         | 修改     | `SseEventType` 镜像枚举新增 2 值                                                                                                                                  |
| `client/src/app/chat/chat.component.ts`                       | 修改     | `handleSseEvent` 新增 2 case → 设置 `limitNotice` 信号                                                                                                            |
| `client/src/app/chat/chat.component.html`                     | 修改     | 渲染 `limitNotice` 内联横幅                                                                                                                                       |
| `docs/1-getting-started/`                                     | 修改     | env 配置说明                                                                                                                                                      |
| `docs/2-architecture/decisions/ADR-012-turn-budget-limits.md` | 新增     | 决策记录（D1–D5）                                                                                                                                                 |

## API Contract

### SSE 事件（新增）

```
event: turn_limit_reached
data: { "limit": 15 }

event: budget_limit_reached
data: { "limit": 1.00 }
```

### 命中限额时的事件序列

```
message_delta                    ← 可能已输出的部分回复
turn_limit_reached | budget_limit_reached   ← 新增，限额通知
stream_complete                  ← 正常关闭（无 error 事件）
```

### 其他错误不受影响

`error_during_execution` / `error_max_structured_output_retries` 等子类型 → 保持现状走 catch → 通用 `error` 事件。

## Risks / Trade-offs

| 风险                                                                       | 缓解                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 默认 15 轮相比当前 20 收紧，重文档生成轮次（8–12 次调用）可能触顶          | 触顶可 resume 继续，非死局；env 一行可调；`.env.example` 注释提示"频繁触顶可调高" |
| `$1.00` 预算为客户端估算值，非权威账单                                     | 边界已注明；本轮只做"限制"不展示，后续可另立成本追踪需求                          |
| SDK throw / break 双路径不确定性                                           | catch 防御性抑制 + 循环 break，任何路径只发一个限额事件                           |
| `thinking` 配置文档与代码矛盾（既有债，spec 写 disabled / 代码为 enabled） | 本次 MODIFIED delta 顺手对齐为代码实际值                                          |

## 验证方法

| 验证项                                      | 命令 / 测试                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 配置解析回退（`parseLimit`）                | `agent.service.spec.ts` 新增用例：空 / 非数字 / `0` / 负数 / 合法值                                                             |
| SDK 选项注入（`maxTurns` / `maxBudgetUsd`） | `agent.service.spec.ts` 断言 query options 含解析后生效值                                                                       |
| 限额命中事件映射                            | `chat.service.spec.ts` 新增用例：mock SDK 产出 `error_max_turns` / `error_max_budget_usd` → 断言发出对应 SSE 事件且抑制 `error` |
| 受控完成（跳过 afterStreamComplete）        | `chat.service.spec.ts` 断言 `limitHit` 时无标题更新 / PRD 提取，仍发 `stream_complete`                                          |
| 前端横幅                                    | 组件单测 / 手动验证：收到事件 → `limitNotice` 显示、输入框可用                                                                  |
| 整体门禁                                    | `pnpm build && pnpm lint && pnpm test`（server）；前端 `pnpm build`                                                             |

## Migration Plan

1. 部署：先更新 `server/.env.example`；`server/.env` 本地按需添加（不填则回退默认 15 / 1.00）
2. 无 DB 迁移、无 API 破坏性变更（仅新增 SSE 事件）
3. 回滚：将 env 调回大数值或删除配置即可（回退默认值仍然生效，永不无限）；代码回滚为上一个发布版本
