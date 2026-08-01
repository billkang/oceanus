## ADDED Requirements

### Requirement: 轮次与预算上限的全局配置

系统 SHALL 通过环境变量 `AGENT_MAX_TURNS` 和 `AGENT_MAX_BUDGET_USD` 配置单次 query 的轮次上限与预算硬顶。任何情况下系统 MUST 保证有生效的上限，不允许因配置缺失或非法导致无限成本。

#### Scenario: 默认值生效

- **WHEN** 环境变量 `AGENT_MAX_TURNS` 与 `AGENT_MAX_BUDGET_USD` 未配置或为空
- **THEN** `AGENT_MAX_TURNS` SHALL 回退默认值 15
- **THEN** `AGENT_MAX_BUDGET_USD` SHALL 回退默认值 1.00

#### Scenario: 非法配置值回退默认

- **WHEN** `AGENT_MAX_TURNS` 或 `AGENT_MAX_BUDGET_USD` 为非数字、`0` 或负数
- **THEN** 对应配置 SHALL 回退默认值
- **THEN** 系统 SHALL 输出 WARN 日志提示配置非法，使用默认值

#### Scenario: 合法配置生效

- **WHEN** 配置 `AGENT_MAX_TURNS=15` 且 `AGENT_MAX_BUDGET_USD=2.5`
- **THEN** 单次 query SHALL 使用 `maxTurns=15` 与 `maxBudgetUsd=2.5`

### Requirement: SDK 轮次与预算选项注入

后端 SHALL 在每次 `SDK.query()` 调用时注入 `maxTurns` 与 `maxBudgetUsd` 选项，替代当前硬编码值。

#### Scenario: 每次 query 注入

- **WHEN** 后端调用 `SDK.query()`
- **THEN** options SHALL 包含 `maxTurns`，其值为 `AGENT_MAX_TURNS` 解析后的生效值
- **THEN** options SHALL 包含 `maxBudgetUsd`，其值为 `AGENT_MAX_BUDGET_USD` 解析后的生效值

### Requirement: 限额命中通知

当单次 query 达到轮次或预算上限时，后端 SHALL NOT 向用户暴露 SDK 原始错误串，而 SHALL 发出明确的 SSE 事件。

#### Scenario: 达到轮次上限

- **WHEN** SDK result 消息 subtype 为 `error_max_turns`
- **THEN** 后端 SHALL 发出 `turn_limit_reached` SSE 事件，data 携带 `limit` 值
- **THEN** 后端 SHALL 抑制通用 `error` SSE 事件（不重复通知）

#### Scenario: 达到预算上限

- **WHEN** SDK result 消息 subtype 为 `error_max_budget_usd`
- **THEN** 后端 SHALL 发出 `budget_limit_reached` SSE 事件，data 携带 `limit` 值
- **THEN** 后端 SHALL 抑制通用 `error` SSE 事件（不重复通知）

#### Scenario: 其他错误不受影响

- **WHEN** SDK result 消息 subtype 不是 `error_max_turns` / `error_max_budget_usd`（如 `error_during_execution`）
- **THEN** 后端 SHALL 照常发出 `error` SSE 事件

### Requirement: 限额命中后的流处理

限额命中后流 SHALL 以"受控完成"方式关闭，会话保持 `active`，用户可继续 resume 聊天。

#### Scenario: 流正常关闭

- **WHEN** 限额命中
- **THEN** 后端 SHALL 仍发出 `stream_complete` 关闭流
- **THEN** 后端 SHALL 跳过标题更新与 PRD 自动提取（afterStreamComplete）
- **THEN** 会话状态 SHALL 保持 `active`，不标记终止

#### Scenario: 用户继续聊天

- **WHEN** 限额命中后用户再次发送消息
- **THEN** 系统 SHALL 以新 query resume 会话，轮次与预算按新 query 重新计算

### Requirement: 限额命中可观测性

限额命中时系统 SHALL 记录日志供事后分析，不记录残缺数据。

#### Scenario: 记录限额命中日志

- **WHEN** 限额命中
- **THEN** sessionLog SHALL 记录 `Turn limit reached` / `Budget limit reached`（含 limit 值）
- **THEN** Langfuse trace SHALL 正常 flush（已生成的 thinking / tool 数据不丢失）
- **THEN** 系统 SHALL 跳过 `recordGeneration`（无完整 generation，不记录残缺数据）

### Requirement: 前端限额提示

前端 SHALL 在收到限额命中事件时展示友好提示，输入框保持可用，会话不关闭。

#### Scenario: 轮次上限提示

- **WHEN** 前端收到 `turn_limit_reached` 事件且 data.limit 为 15
- **THEN** 前端 SHALL 展示内联提示横幅"已达到本次轮次上限（15 轮），你可以继续发送消息"
- **THEN** 输入框 SHALL 保持可用，会话不关闭

#### Scenario: 预算上限提示

- **WHEN** 前端收到 `budget_limit_reached` 事件且 data.limit 为 1.00
- **THEN** 前端 SHALL 展示内联提示横幅"已达到本次预算上限（$1.00），你可以继续发送消息"
- **THEN** 输入框 SHALL 保持可用，会话不关闭
