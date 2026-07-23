## ADDED Requirements

### Requirement: 使用 SDK 真实 session_id 替代社区生成的 uuid

Session 记录必须使用 Claude Agent SDK 在 `system/init` 事件中返回的真实 `session_id`，而非应用自行生成的 UUID。后续所有消息通过 `resume: sessionId` 续传同一 SDK 会话。

#### Scenario: 首次消息获取 SDK session_id

- **WHEN** 用户发送首条消息（`action: message`，无 `sessionId`）
- **THEN** 后端调用 `SDK.query()` 不带 resume 参数
- **THEN** 后端从 `system/init` 事件中提取 `session_id`
- **THEN** 后端以该 `session_id` 作为 `sdkSessionId` 写入数据库
- **THEN** SSE 流首事件返回该 `sessionId`
- **THEN** 后续消息均需携带此 `sessionId`

#### Scenario: 后续消息使用 resume 续传

- **WHEN** 同一会话的用户发送后续消息（`action: message`，携带 `sessionId`）
- **THEN** 后端调用 `SDK.query({ resume: sessionId })`
- **THEN** SDK 在已有会话上下文中继续推理
- **THEN** SSE 流实时推送后续事件（`message_delta`、`tool_use` 等）

#### Scenario: 不存在的 sessionId 返回 404

- **WHEN** 前端携带一个数据库中不存在的 `sessionId`
- **THEN** 后端返回 404 错误
- **THEN** SSE 流中发出 `error` 事件

### Requirement: 删除旧的 uuid 字段

Session 表的 `uuid` 字段及其 `@default(uuid())` 生成逻辑必须移除。项目无关会话不再留存。

#### Scenario: Session 记录去 uuid

- **WHEN** 系统创建新的 Session 记录
- **THEN** Session 表 `id` 仍为自增主键
- **THEN** 不存在 `uuid` 字段
- **THEN** `sdkSessionId` 为 `@unique` 且非空

### Requirement: 消息轮次管理和标题自动生成

后端需要追踪每个会话的消息轮次数，在 N 轮后自动根据首条消息生成标题。

#### Scenario: 第二轮消息后标题更新

- **WHEN** 同一会话完成至少 2 轮消息往返
- **THEN** 后端使用首条用户消息的前 30 字符作为标题
- **THEN** 标题更新事件通过 SSE 推送给前端
- **THEN** 数据库 Session 记录的 `title` 字段更新

#### Scenario: 已有人工标题跳过自动更新

- **WHEN** Session 的 `title` 不为 `新会话`
- **THEN** 跳过标题自动更新逻辑

### Requirement: 删除会话时清理 JSONL 文件

删除 Session 数据库记录时必须同时清理磁盘上的 JSONL 文件。文件路径应基于 `projectId`/`sdkSessionId` 按 SDK 目录规则计算，而非依赖 DB 中存储的 `filePath` 字段，避免路径数据不一致导致残留。

#### Scenario: 删除会话清理 JSONL

- **WHEN** 前端调用 `DELETE /sessions/:sdkSessionId`
- **THEN** 后端使用 `data/sessions/{projectId}/{sdkSessionId}.jsonl` 定位 JSONL 文件
- **THEN** 文件存在时删除
- **THEN** 删除 Session 数据库记录
- **THEN** 文件删除失败不影响数据库删除（graceful degradation）
