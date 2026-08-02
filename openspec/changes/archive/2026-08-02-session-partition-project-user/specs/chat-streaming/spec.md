# chat-streaming Specification

## MODIFIED Requirements

### Requirement: 发送消息

用户 SHALL 可在聊天输入框中发送消息，通过统一端点 `POST /api/v1/chat`（`action: message`）转发给 Agent SDK 处理，不持久化到数据库。新会话必须携带 `projectName`（项目 projectName），不传 `sessionId`；后续消息携带 `sessionId`，服务端从会话记录推导分区并校验所有权，通过 SDK 的 `resume` 机制续传。

出于并发控制，请求可能进入队列等待。

#### Scenario: 发送文本消息（新会话，直接处理）

- **WHEN** 并发未超限，用户在输入框中输入消息并发送（无 sessionId）
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "你好", projectName: "project-a" }`
- **THEN** 后端校验当前用户是 `project-a` 项目成员（非成员返回 404）
- **THEN** 后端以 `(projectName, username)` 构建分区
- **THEN** 后端通过并发守卫检查 → 活跃请求数未超限 → 直接调用 Agent SDK（不带 resume）
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
- **THEN** 后端以 `sessionId` 查会话记录，校验 `session.username === 当前用户`（非所有者返回 404）
- **THEN** 后端从 `session.project.projectName` 与 `session.username` 推导分区
- **THEN** 后端通过并发守卫检查 → 可执行时调用 `SDK.query({ resume: sessionId })`
- **THEN** SSE 流实时推送后续事件（`message_delta`、`tool_use` 等）

#### Scenario: 同一会话新消息中断旧消息（并发超限时）

- **WHEN** 同一 sessionId 已有活跃请求（在执行中或队列中），新消息到达
- **THEN** 旧请求被中断（SDK interrupt + 从队列移除）
- **THEN** 新消息入队或直接执行

#### Scenario: 发送空消息

- **WHEN** 用户尝试发送空消息或仅空白字符
- **THEN** 抛出 400 错误："消息内容不能为空"

#### Scenario: 不存在的 sessionId 返回 404

- **WHEN** 前端携带一个数据库中不存在或非当前用户所有的 `sessionId`
- **THEN** 后端返回 404 错误（统一"不存在"语义，不区分不存在与无权限）
- **THEN** SSE 流中发出 `error` 事件

#### Scenario: 新会话缺少 projectName

- **WHEN** 前端发送新会话首条消息但未携带 `projectName`
- **THEN** 后端返回 400 错误："缺少项目标识 projectName"

### Requirement: 流完成后处理管线

每条消息的 SSE 流完成后，后端 SHALL 按固定管线执行后处理：更新 lastMessageAt → 标题更新 → PRD 自动提取。

#### Scenario: 更新最后消息时间

- **WHEN** SSE 流完成（`stream_complete`）
- **THEN** 后端将 Session 记录的 `lastMessageAt` 更新为当前时间
- **THEN** 会话列表按该时间倒序排序有真实依据

#### Scenario: 标题更新触发

- **WHEN** SSE 流完成且消息轮次 ≥ 1
- **THEN** 后端发出 `tool_in_progress`（status: "正在更新标题..."）
- **THEN** 检查 Session 标题是否为 "新会话"（默认值）
- **WHEN** 标题仍为默认值
- **THEN** 取首条用户消息的前 30 字符作为标题，写入数据库
- **THEN** 发出 `title_updated` SSE 事件通知前端
- **THEN** 发出 `tool_complete` 事件
- **WHEN** 标题已被人工修改（不为 "新会话"）
- **THEN** 跳过自动更新

#### Scenario: PRD 自动提取触发

- **WHEN** 标题更新完成且累计响应文本 ≥ 50 字符
- **THEN** 后端发出 `tool_in_progress`（status: "正在分析PRD..."）
- **THEN** 检测响应文本是否包含 PRD 标记（`# PRD`、`# 产品需求`、`产品需求文档`、`## 功能需求` 等）
- **WHEN** 检测到 PRD 标记
- **THEN** 提取标题（优先使用 `# ` 一级标题），将完整响应文本作为 PRD 资产存入数据库
- **THEN** 发出 `asset_ready` SSE 事件（含 assetId 和 title）
- **THEN** 发出 `tool_complete` 事件
- **WHEN** 未检测到 PRD 标记
- **THEN** 跳过 PRD 提取，不产生资产
