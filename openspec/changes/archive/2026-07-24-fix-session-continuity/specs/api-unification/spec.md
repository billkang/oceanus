## ADDED Requirements

### Requirement: 统一 POST /api/v1/chat 端点

所有会话操作通过单一端点 `POST /api/v1/chat` 处理，通过 `action` 字段区分操作类型。所有 action 响应均为 SSE 流，前端统一使用同一套 SSE reader 处理。

#### Scenario: 发送消息（新会话）

- **WHEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "你好", projectId: 1 }`
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** SSE 流首事件为 `{ type: "session_created", data: { sdkSessionId: "sdk-uuid-xxx" } }`
- **THEN** SSE 流后续事件为 SDK 回复内容（`message_delta`、`tool_use` 等）

#### Scenario: 发送消息（续传）

- **WHEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "继续", sessionId: "sdk-uuid-xxx" }`
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** 后端调用 `SDK.query({ resume: "sdk-uuid-xxx" })`
- **THEN** SSE 流推送 SDK 回复内容

#### Scenario: 确认选择

- **WHEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "confirm", sessionId: "sdk-uuid-xxx", confirmOption: "option_1" }`
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** 首事件为 `{ type: "confirm_accepted", data: {} }`
- **THEN** 后续事件为 SDK 继续推理的流式回复（`message_delta`、`tool_use` 等）
- **THEN** 前端复用同一 SSE reader 解析

#### Scenario: 请求体验证

- **WHEN** 前端 POST `POST /api/v1/chat` `action: message` 不传 `content`
- **THEN** 后端返回 400 错误: "消息内容不能为空"

- **WHEN** 前端 POST `POST /api/v1/chat` `action: confirm` 不传 `sessionId`
- **THEN** 后端返回 400 错误: "confirm 需要 sessionId"

- **WHEN** 前端 POST `POST /api/v1/chat` `action: confirm` 不传 `confirmOption`
- **THEN** 后端返回 400 错误: "confirm 需要 confirmOption"

### Requirement: 删除旧接口

`POST /sessions/:id/chat`、`GET /sessions/:id/events`、`POST /sessions/:id/agent/confirm` 接口必须删除，不再提供。

#### Scenario: 旧接口返回 404

- **WHEN** 前端请求 `POST /sessions/1/chat`
- **THEN** 后端返回 404 Not Found

#### Scenario: 保留的业务接口可用

- **WHEN** 前端请求 `GET /sessions`（项目会话列表）
- **THEN** 后端返回该项目的 Session 列表（含 `sdkSessionId`、`title`、`createdAt`、`lastMessageAt`）

- **WHEN** 前端请求 `GET /sessions/:sdkSessionId`（会话详情）
- **THEN** 后端返回该 Session 的详细数据（含项目名、标题、创建时间等）

- **WHEN** 前端请求 `GET /sessions/:sdkSessionId/messages`（会话历史消息）
- **THEN** 后端通过 `FileSystemSessionStore.load()` 读取 JSONL 文件
- **THEN** 后端调用 SDK `getSessionMessages()` 返回结构化消息数组
- **THEN** 前端渲染该会话的所有历史消息

- **WHEN** 前端请求 `DELETE /sessions/:sdkSessionId`（删除会话）
- **THEN** 后端删除 Session 记录及关联的 JSONL 文件

### Requirement: Confirm 后的 SSE 流实时推送

用户确认选择后，SDK 后续的推理结果必须通过 SSE 流实时推送给前端，不得等整个响应完成后再返回。

#### Scenario: Confirm 后收到 message_delta

- **WHEN** 用户确认选择（`action: confirm`）
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** 前端逐个收到 `message_delta` 事件（字符级流式推送）
- **THEN** 前端收到 `message_complete` 事件表示该轮回复结束

#### Scenario: Confirm 后遇到再次 tool_options

- **WHEN** 用户确认后 SDK 又遇到选择点
- **THEN** SSE 流发出 `tool_options` 事件
- **THEN** SSE 流正常关闭
- **THEN** 前端显示选择项供用户再次确认
