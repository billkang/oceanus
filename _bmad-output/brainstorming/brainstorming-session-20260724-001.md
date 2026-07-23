# Brainstorming Session: 会话连续性修复

> **日期**: 2026-07-24
> **Change**: `fix-session-continuity`
> **路径**: Path B（开放讨论）

## 讨论主题

Oceanus 聊天系统的会话连续性存在问题——每次发送消息都开启新的 SDK 会话，无法保持对话上下文。

## 关键决策

1. **弃用 `continue: true` 自动检测** — 改为显式 `resume: sessionId`，由 SDK 真实会话 UUID 控制
2. **不自己生成 UUID** — 删除 Session 表的 `uuid` 字段，直接使用 SDK 返回的 `session_id`
3. **懒创建 Session 记录** — 用户发首条消息后才创建数据库记录，不再一打开页面就创建空 session
4. **统一 API 端点** — 单个 `POST /api/v1/chat`
   - `action: message` → 发送消息，响应为 SSE 流
   - `action: confirm` → 用户确认选择，响应为 JSON
   - `action: cancel` → 中断当前流（预留）
   - 前端携带/不携带 `sessionId` 决定首条/续传
   - 不再需要独立的 SSE 或 confirm 端点

## 需求要点

### 核心问题

当前架构中：
- `sdkSessionId` 存储的是硬编码 `'1'`（假 ID），不是 SDK 真实会话 UUID
- 使用 `continue: true` 让 SDK 自动盲找最近会话，不稳定
- 首条消息从不捕获 SD  K 返回的 `init` 系统消息中的 `session_id`

### 目标

1. 捕获 SDK `system/init` 中的真实 `session_id`
2. 用真实 session_id 替换假 ID `'1'`
3. 后续消息用 `resume: sessionId` 而非 `continue: true`
4. 统一接口：前端传 `sdkSessionId` 就是续传，不传就是首条

## 边界范围

| 范围 | 包含/不包含 |
|------|------------|
| Session 表去 uuid | ✅ 做 |
| sdkSessionId 改为非空、@unique | ✅ 做 |
| 懒创建（首条消息后才落库） | ✅ 做 |
| 统一 API POST /api/v1/chat | ✅ 做 |
| `forkSession` 分支能力 | ❌ 不做（第一版只修复续传） |
| 前端 UI 改造 | ✅ 只改发送流程（去掉页面加载创建 session） |
| 数据库 migration 合并 | ✅ 已做（系统未上线） |
| WebSocket 替代 SSE | ❌ 不做，保持现有 SSE |
| 消息记录在数据库 | ❌ 不做，SDK JSONL 存储已够用 |

## 技术方案摘要

```
POST /api/v1/chat  { content, projectId?, sdkSessionId? }

无 sdkSessionId → SDK query() 无 resume
  → 捕获 system/init → session_id
  → CREATE session (sdkSessionId = 真实 UUID)
  → 流中首事件: { type: "session_created", data: { sdkSessionId } }

有 sdkSessionId → SDK query() 带 resume: sdkSessionId
  → 直接流式回复
```

## 后续步骤

1. 生成 proposal → specs → design → tasks（Stage 3）
2. spec-hardener 五道筛
3. writing-plans 实现计划
4. 加载 TDD superpower → 按 RED→GREEN→REFACTOR 实现
