# request-queue Specification

## Purpose

Oceanus 后端请求队列能力：LLM 并发超限时将 `/chat` 请求排入 FIFO 队列，支持取消排队、位置更新事件，并在单进程/Cluster 模式下均正常工作。

## Requirements

### Requirement: 请求入队与 FIFO 消费

系统 SHALL 在 `/chat` 请求到达时，如果当前 LLM API 并发调用数已达上限，将请求排入内存队列，按 FIFO 顺序逐一出队处理。

#### Scenario: 并发未超限直接处理

- **WHEN** 请求到达时当前活跃 LLM 请求数 < `MAX_CONCURRENT_LLM`（默认 3；Rationale：假设 Key 池有 3 个 API Key，每个 Key 可容忍 1 个并发，总并发 = Key 数量 × 1；可视 Key 池大小和 API 限制调高）
- **THEN** 请求直接执行，不入队
- **THEN** 活跃请求计数 +1

#### Scenario: 并发超限时排队

- **WHEN** 请求到达时活跃 LLM 请求数 >= `MAX_CONCURRENT_LLM`
- **THEN** 请求入队（FIFO 位置末尾）
- **THEN** SSE 流发送排队状态事件 `{ type: "queued", data: { position: N, estimatedWait: "约 30 秒" } }`
- **THEN** 前端显示排队提示

#### Scenario: 队列出队与执行

- **WHEN** 当前活跃请求完成（LLM API 返回 stream 结束或出错）
- **THEN** 活跃请求计数 -1
- **THEN** 从队列头部取出下一个请求
- **THEN** 该请求进入执行阶段（调用 Agent SDK）
- **THEN** 活跃请求计数 +1

#### Scenario: 队列满时拒绝

- **WHEN** 队列长度达到 `REQUEST_QUEUE_MAX_SIZE`（默认 50）
- **THEN** 新请求不排队，直接返回 429
- **THEN** 响应体为 `{ "success": false, "statusCode": 429, "message": "系统繁忙，请稍后重试" }`

### Requirement: 请求取消（出队前）

用户 SHALL 可以在请求尚在队列中时取消。

#### Scenario: 队列中取消请求

- **WHEN** 用户发送 `action: cancel` 且该 sessionId 对应的请求仍在队列中（尚未开始执行）
- **THEN** 系统将请求从队列中移除
- **THEN** SSE 流发送 `stream_complete` 事件正常结束
- **THEN** 队列后续请求前移

#### Scenario: 已开始执行的请求取消

- **WHEN** 用户发送 `action: cancel` 但该 sessionId 对应的请求已在执行中
- **THEN** 走现有 `activeQueries` 中断逻辑（SDK interrupt）
- **THEN** 任务从队列活跃计数中移除

### Requirement: 队列状态可见性

SSE 流 SHALL 在排队期间定期推送位置更新。

#### Scenario: 排队位置更新

- **WHEN** 请求处于队列中且前方排队数量发生变化
- **THEN** SSE 流推送 `{ type: "queue_position", data: { position: N, totalBefore: N } }`
- **THEN** 更新频率不超过每 5 秒一次

### Requirement: 非 Cluster 模式下的队列行为

系统 SHALL 在单进程模式下也能正常工作，队列和并发控制仅作用于当前进程。

#### Scenario: 单进程队列

- **WHEN** 未启用 Cluster 模式（单进程）
- **THEN** 请求队列正常运作，作用于当前进程
- **THEN** `MAX_CONCURRENT_LLM` 按单进程计算

#### Scenario: Cluster 下队列跨进程协调

- **WHEN** 启用了 Cluster 模式
- **THEN** 每个 worker 独立维护出队逻辑
- **THEN** 通过 Redis 共享全局活跃请求计数
- **THEN** 当 Redis 不可用时，每个 worker 独立运行本地队列

### Requirement: SSE 流队列事件推送时机

SSE 流 SHALL 在请求入队、位置变化、出队执行、执行完成这四个节点推送事件。

#### Scenario: 入队事件

- **WHEN** 请求确认入队
- **THEN** SSE 流立即发送 `queued` 事件（含 position 和 estimatedWait）

#### Scenario: 出队执行事件

- **WHEN** 请求从队列头部取出，开始执行
- **THEN** SSE 流发送 `dequeued` 事件
- **THEN** 后续按正常 SSE 流推送 SDK 事件
