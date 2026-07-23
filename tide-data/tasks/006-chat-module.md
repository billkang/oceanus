# 任务 006 — Chat Module — 消息收发 API + SSE 流式推送

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-6

---

## 描述

实现聊天消息的收发功能和 SSE 流式推送。用户发送消息后，前端通过 SSE 实时接收 AI 的响应内容。

**架构变更说明（2026-07-23）：** 消息内容不再持久化到数据库，改为由 Claude Agent SDK JSONL 机制自动管理。API 层仅做消息转发——POST 时转发给 SDK，GET 时从 SDK `getSessionMessages()` 读取。

## API 接口

### POST /api/sessions/:id/messages
发送用户消息。后端转发给 SDK agent 处理，**不持久化到数据库**，AI 响应通过 SSE 推送。
**请求体:**
```json
{
  "content": "用户消息内容"
}
```

### GET /api/sessions/:id/messages
获取会话历史消息列表。**从 SDK 的 `getSessionMessages()` 读取**，不走数据库查询。
**响应:**
```json
{
  "messages": [
    {"role": "user", "content": "...", "createdAt": "..."},
    {"role": "assistant", "content": "...", "createdAt": "..."}
  ]
}
```

### GET /api/sessions/:id/events
SSE 端点，前端通过 EventSource 连接。
**事件格式:**
```
event: message_start
data: {"type": "text", "content": "正在分析需求..."}

event: message_delta
data: {"type": "text", "content": "最新追加的文本"}

event: message_done
data: {"type": "complete"}

event: tool_use
data: {"type": "options", "options": ["A方案", "B方案", "其他"]}

event: error
data: {"type": "error", "message": "AI 服务异常，请重试"}
```

## 验收标准

- [ ] 用户消息可发送并转发给 SDK agent
- [ ] SSE 端点可正常连接，接收流式事件
- [ ] SDK 状态变化通过 SSE 实时通知前端
- [ ] 历史消息通过 SDK 的 `getSessionMessages()` 正常读取
- [ ] 支持断线重连
- [ ] SDK 确认交互事件通过 SSE 推送

## 技术要点

- 使用 NestJS 的 `@Sse()` 装饰器或 RxJS Subject 实现 SSE
- 消息按会话 ID 隔离，不同会话的 SSE 连接互不影响
- 后端维护每个会话的 SSE Subject + SDK agent 实例映射
- 消息内容**不写入数据库**，全部由 SDK JSONL 管理
- Nginx 需要配置 `proxy_buffering off; proxy_cache off;`
