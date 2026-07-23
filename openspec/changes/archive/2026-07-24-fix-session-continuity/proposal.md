## Why

当前 Oceanus 聊天系统的会话连续性存在缺陷：每次用户发送消息，Claude Agent SDK 都会开启新的会话，无法保持对话上下文。原因是后端使用 `continue: true`（自动盲找最近会话），且存入数据库的 `sdkSessionId` 是硬编码 `'1'` 而非 SDK 的真实会话 UUID。这导致多轮对话形同虚设。

## What Changes

- **BREAKING**: Session 表删除自生成 `uuid` 字段，改为使用 SDK 返回的 `sdk_session_id` 作为唯一标识
- **BREAKING**: Session 记录改为懒创建——用户发送首条消息后从 SDK init 事件捕获真实 session_id 后再写入数据库
- **API 统一**: 单个 `POST /api/v1/chat` 端点，通过 `action` 字段区分操作类型
  - `action: message` → 发送消息，响应为 SSE 流（Content-Type: text/event-stream）
  - `action: confirm` → 用户确认选择，响应为 JSON
  - `action: cancel` → 中断当前流（预留）
- 后续消息使用 `resume: sessionId` 替代 `continue: true`
- 删除旧接口: ~~`POST /sessions/:id/chat`~~ ~~`GET /sessions/:id/events`~~ ~~`POST /sessions/:id/agent/confirm`~~
- 保留的业务接口: `GET /sessions` `GET /sessions/:sdkSessionId` `DELETE /sessions/:sdkSessionId`
- 删除 `uuid` 字段上 `@default(uuid())` 生成逻辑

## Capabilities

### New Capabilities

- `session-continuity`: Session 会话连续性——确保多轮对话在同一 SDK 会话上下文中进行
- `lazy-session-creation`: 懒创建 Session 记录——首条消息后才创建，避免空 session 记录
- `api-unification`: API 统一——单个 `POST /api/v1/chat` 端点处理所有会话操作

### Modified Capabilities

<!-- 无现有 spec 需要修改 -->

## Impact

- **数据库**: Session 表 schema 变更（去 uuid、sdkSessionId 改为 @unique 非空）
- **后端 API**: 删减为单端点 `POST /api/v1/chat`；保留 `GET /sessions` 等只读接口
- **后端服务**: `ChatService` 流处理逻辑变更（捕获 init event、resume 替代 continue、按 action 区分响应格式）
- **前端**: 去掉页面加载时创建 session 的逻辑；首条消息导航到新 session；根据 action 决定 response 解析方式
- **Langfuse**: 使用 SDK session_id 替代自生成 UUID 作为 trace ID
- **迁移**: 系统未上线，无数据迁移需求
