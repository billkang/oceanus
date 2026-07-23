# 任务 004 — Project Module — 项目 CRUD API

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-2, FR-3

---

## 描述

实现项目的创建、列表查看功能。

## API 接口

### GET /api/projects
获取当前用户的项目列表（按更新时间倒序）。
**响应:**
```json
{
  "projects": [
    {"id": "uuid", "name": "项目名称", "description": "备注", "sessionCount": 3, "updatedAt": "..."}
  ]
}
```

### POST /api/projects
创建新项目。
**请求体:**
```json
{
  "name": "项目名称",
  "description": "项目备注（可选）"
}
```

### GET /api/projects/:id
查看单个项目详情。

### DELETE /api/projects/:id
删除项目（级联删除会话和消息）。

## 验收标准

- [ ] 可创建项目（名称+备注）
- [ ] 项目列表按更新时间倒序
- [ ] 项目列表展示包含会话数量
- [ ] 可删除项目
- [ ] 删除项目时级联删除关联的会话和消息
- [ ] 只有项目创建者可操作自己的项目

## 技术要点

- 使用 Prisma 操作数据库
- 项目与会话的级联删除通过 Prisma 的 `onDelete: Cascade` 实现
- 返回数据中 `sessionCount` 通过 Prisma 的 `_count` 聚合计算
