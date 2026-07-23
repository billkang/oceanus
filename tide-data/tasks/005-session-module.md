# 任务 005 — Session Module — 会话创建/列表/删除

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-4, FR-12

---

## 描述

实现项目下的会话管理功能，包括创建、历史列表以及删除（级联清理）。会话的完整消息记录由 Claude Agent SDK JSONL 管理，数据库仅存映射关系。

**架构变更说明（2026-07-23）：** 
- ❌ 移除归档能力（archive endpoint）
- ❌ 移除上下文恢复端点（/state endpoint）
- ❌ 移除 context JSON 字段
- ✅ 新增物理删除能力（DELETE endpoint）
- ✅ 新增 filePath 字段管理 SDK JSONL 文件位置

## API 接口

### POST /api/projects/:projectId/sessions
创建新会话。创建时同时初始化 SDK agent 会话，记录 filePath。
**响应:**
```json
{
  "session": {
    "id": "uuid",
    "title": "新会话",
    "filePath": "/path/to/sdk/jsonl/file",
    "createdAt": "..."
  }
}
```

### GET /api/projects/:projectId/sessions
获取项目下的会话列表（时间倒序）。
**响应:**
```json
{
  "sessions": [
    {"id": "uuid", "title": "...", "filePath": "...", "createdAt": "..."}
  ]
}
```

### GET /api/sessions/:id
获取单个会话详情。

### DELETE /api/sessions/:id
删除会话（物理删除）。级联操作：
1. 从数据库删除 session 记录及其关联 assets
2. 清理 SDK JSONL 文件
3. 通知 Agent Module 清理 SDK 会话实例

## 消息读取（走 SDK）

会话消息的读取不走 Session Module，通过 Chat Module 调用 SDK `getSessionMessages()` 获取。

## 验收标准

- [ ] 可在项目下创建新会话，filePath 自动生成
- [ ] 会话列表按时间倒序展示
- [ ] 删除会话时，DB 记录 + JSONL 文件 + SDK 实例三者全部清理
- [ ] 删除时级联清理关联的 assets

## 技术要点

- 删除操作为物理删除，不做软删除/归档
- filePath 建议约定：`data/sessions/{projectId}/{sessionId}.jsonl`
- 需确认 SDK 的 `SessionStore.delete()` 是否支持文件级删除
- 删除前需确认用户意图（前端二次确认弹窗）
