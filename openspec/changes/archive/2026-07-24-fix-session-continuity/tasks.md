## 1. SSE 事件类型与 DTO

- [x] 1.1 在 `sse-events.ts` 新增 `SseSessionCreated`、`SseConfirmAccepted` 事件类型并加入联合类型
- [x] 1.2 新增 `chat/dto/chat-request.dto.ts`：`ChatMessageRequest`、`ChatConfirmRequest`、`ChatCancelRequest` DTO 定义
- [x] 1.3 新增 `chat/dto/chat-response.ts`：可选，确认 SSE 事件接口定义足够覆盖

## 2. Session 服务层更新

- [x] 2.1 `session.service.ts` 新增 `getBySdkSessionId()` — 用 sdkSessionId 查找 session（已有，确认正确）
- [x] 2.2 `session.service.ts` 新增 `deleteBySdkSessionId()` — 按 sdkSessionId 删除，JSONL 路径按 `data/sessions/{projectId}/{sdkSessionId}.jsonl` 计算清理
- [x] 2.3 `session.service.ts` 删除 `updateSdkSessionId()` — 不再需要延迟更新
- [x] 2.4 `session.controller.ts` 接口路径从 `:id` (ParseIntPipe) 改为 `:sdkSessionId` (string)

## 3. Agent 服务层——resume 替代 continue

- [x] 3.1 `agent.service.ts` 修改 `sendMessage()`：接受 `{ sessionId: string, content: string }`，不再需要 `sessionUuid`、`continueSession`、`projectId` 参数
- [x] 3.2 首条消息不传 resume，后续消息传 `resume: sessionId`
- [x] 3.3 更新 hooks：SessionStart hook 使用 `sessionId` 作为 Langfuse trace ID（首条消息时可能为 null，等 init 后重建）
- [x] 3.4 更新 PostToolUse/PostToolUseFailure/SessionEnd hooks 使用 sdkSessionId 替代 sessionUuid
- [x] 3.5 移除 `confirmChoice()` 和 `cancelResponse()`——确认逻辑改为 resume 发消息

## 4. ChatService 核心重写

- [x] 4.1 新增 `sendAndStream()` 方法：接收 `{ sdkSessionId?: string, content: string, onEvent }`，不再使用 numeric sessionId
- [x] 4.2 **首条消息逻辑**：调用 `SDK.query()` 无 resume → 遍历 AsyncGenerator 直到 `system/init` → 提取 `session_id` → 调用 `SessionService.create()` 懒创建 → SSE 流首事件 `session_created`
- [x] 4.3 **续传逻辑**：调用 `SDK.query({ resume: sdkSessionId, prompt: content })` → SSE 流推送 SDK 回复
- [x] 4.4 **confirm 逻辑**：新方法 `confirmAndStream()` — 等价于续传，将 `confirmOption` 作为 content 调用续传逻辑
- [x] 4.5 **cancel 逻辑**：使用 `activeQueries` Map（keyed by sdkSessionId）持有 query.interrupt 引用，调用时中断
- [x] 4.6 **并发消息处理**：同一 sdkSessionId 有新 `action: message` 时，先 `interrupt()` 旧流并 await 完成，再处理新消息
- [x] 4.7 移除 `inFlightBuffers`、`messageRoundCount`、`firstUserMessage` 中的 numeric key，改为 sdkSessionId key
- [x] 4.8 `afterStreamComplete()` 内 `tryUpdateTitle()` / `tryExtractPrd()` 使用 sdkSessionId 查找 session
- [x] 4.9 新增 `getSessionHistory(sdkSessionId)`：调用 `AgentService.getSessionMessages()` 返回历史消息

## 5. ChatController 重写——单端点 POST /api/v1/chat

- [x] 5.1 删除旧接口：`POST /sessions/:id/chat`、`GET /sessions/:id/events`、`POST /sessions/:id/confirm`
- [x] 5.2 删除 `subjects` Map——不再使用 Subject 推送模式
- [x] 5.3 新增 `POST /api/v1/chat`：根据 `action` 字段分发到 `sendAndStream()` / `confirmAndStream()` / `cancelResponse()`
- [x] 5.4 `action: message` 和 `action: confirm` 返回 `Content-Type: text/event-stream`（通过 NestJS `@Sse()` 或直接操作 Response stream）
- [x] 5.5 保留 `GET /sessions/:id/messages` 并改为使用 `sdkSessionId` (string) 而非 numeric id
- [x] 5.6 请求体验证：action=message 需 content；action=confirm 需 sessionId+confirmOption；action=cancel 需 sessionId

## 6. AgentController 清理

- [x] 6.1 删除 `POST /sessions/:id/agent/confirm`
- [x] 6.2 删除 `POST /sessions/:id/agent/cancel`

## 7. Langfuse 时序适配

- [x] 7.1 首条消息：SessionStart hook 中暂时无法获得 sdkSessionId，先跳过 Langfuse trace 或生成临时 ID
- [x] 7.2 捕获 `system/init` session_id 后，使用该 ID 创建/重建 Langfuse trace
- [x] 7.3 验证 langfuse service 中 trace ID 从 sdkSessionId 创建，不依赖 sessionUuid

## 8. 后端验证

- [x] 8.1 `npm run build` 通过
- [x] 8.2 检查所有 sessionUuid 引用已被 sdkSessionId 替代
- [x] 8.3 检查 sessionService 的 import 和调用方式兼容新签名
- [x] 8.4 端到端验证：启动后端，curl POST /api/v1/chat 验证 SSE 流输出

## 9. 前端竞态条件修复（2026-07-24 追加）

- [x] 9.1 `send()` 方法中 `this.isStreaming.set(true)` 提前到 SSE API 调用之前，防止 `session_created` → sessionId 信号传播 → effect → loadHistory() 清空用户消息
- [x] 9.2 `retry()` 方法同样提前设置 `isStreaming=true`，与 send() 保持一致
- [x] 9.3 合并发送/中断按钮：用 `@if(isStreaming())` 在同一按钮位置切换发送（纸飞机）和中断（方块）图标，移除输入区上方的独立中断按钮
- [x] 9.4 添加测试用例 `send() 应立即设置 isStreaming=true 以保护会话内消息`
- [x] 9.5 验证：`npm run test -- --project client` 通过
