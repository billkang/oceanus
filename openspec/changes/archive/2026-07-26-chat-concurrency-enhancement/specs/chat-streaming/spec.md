## MODIFIED Requirements

### Requirement: 发送消息

用户可在聊天输入框中发送消息，通过统一端点 `POST /api/v1/chat`（`action: message`）转发给 Agent SDK 处理。出于并发控制，请求可能进入队列等待。
新会话不传 `sessionId`，后续消息携带 `sessionId` 通过 SDK 的 `resume` 机制续传。

#### Scenario: 发送文本消息（新会话，直接处理）

- **WHEN** 并发未超限，用户在输入框中输入消息并发送
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "你好", projectId: 1 }`
- **THEN** 后端通过并发守卫检查 → 活跃请求数未超限 → 直接调用 Agent SDK
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** SSE 流首事件为 `{ type: "session_created", data: { sdkSessionId: "sdk-uuid-xxx" } }`
- **THEN** SSE 流后续事件为 SDK 回复内容（`message_delta`、`tool_use` 等）
- **THEN** 前端保存 `sdkSessionId` 用于后续消息

#### Scenario: 发送文本消息（排队处理）

- **WHEN** 并发超限，请求进入队列
- **THEN** SSE 流首事件为 `{ type: "queued", data: { position: 3, estimatedWait: "约 30 秒" } }`
- **THEN** 队列位置前移时收到 `queue_position` 事件
- **THEN** 出队开始执行时收到 `dequeued` 事件
- **THEN** 后续事件与正常处理一致（`session_created`、`message_delta` 等）

#### Scenario: 发送文本消息（续传）

- **WHEN** 同一会话的用户发送后续消息
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "继续", sessionId: "sdk-uuid-xxx" }`
- **THEN** 后端通过并发守卫检查 → 可执行时调用 `SDK.query({ resume: sessionId })`
- **THEN** SSE 流实时推送后续事件（`message_delta`、`tool_use` 等）

#### Scenario: 同一会话新消息中断旧消息（并发超限时）

- **WHEN** 同一 sessionId 已有活跃请求（在执行中或队列中），新消息到达
- **THEN** 旧请求被中断（SDK interrupt + 从队列移除）
- **THEN** 新消息入队或直接执行

### Requirement: 发送/中断按钮状态切换（队列感知）

输入区右下角的按钮根据流式状态切换功能。当请求在队列中等待时，按钮显示为等待状态。

#### Scenario: 排队等待状态下显示取消按钮

- **WHEN** 请求已入队但尚未开始执行
- **THEN** 按钮显示为"取消排队"状态
- **THEN** 点击触发 `action: cancel` 从队列中移除请求

## ADDED Requirements

### Requirement: 队列 UI 状态提示

前端 SHALL 在 SSE 流收到排队相关事件时展示对应的 UI 状态。

#### Scenario: 显示排队提示

- **WHEN** SSE 流收到 `queued` 事件
- **THEN** 助理消息气泡位置显示排队提示卡片："您的请求已排队，前方还有 N 位"
- **THEN** 卡片样式为等待态（非错误态）

#### Scenario: 排队位置更新

- **WHEN** SSE 流收到 `queue_position` 事件
- **THEN** 排队提示卡片的排队数字更新为最新位置

#### Scenario: 出队执行

- **WHEN** SSE 流收到 `dequeued` 事件
- **THEN** 排队提示卡片移除
- **THEN** 前端创建助理消息气泡（`MessageStart` 事件到达时）
