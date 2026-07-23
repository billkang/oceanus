# 任务 002 — Prisma Schema 设计与数据库迁移

**Epic:** 项目脚手架与基础设施
**优先级:** P0
**关联需求:** —

---

## 描述

设计并创建 Oceanus MVP 的数据库 Schema，包含 4 张核心表，使用 Prisma ORM 管理。

**架构变更说明（2026-07-23）：** 采用混合存储架构 — Claude Agent SDK 内置 JSONL 机制管理完整会话消息，数据库仅存映射关系。`messages` 表移除，`sessions` 表极简化。详见 `tide-data/prds/tide-20260723-001-prd.md`。

## 表结构

> **主键策略：** INT 自增主键 + UUID 字段。自增主键用于关联查询和排序效率，UUID 字段用于对外暴露标识。详见设计决策 D2。

### users（测试用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Int (auto-increment) | 主键 |
| username | String | 测试账号（写死） |
| password | String | 加密存储 |
| displayName | String | 显示名称 |
| active | Boolean | 是否启用 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### projects（项目）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Int (auto-increment) | 主键 |
| uuid | String (UUID) | 对外标识 |
| name | String | 项目名称 |
| description | String? | 备注（可选） |
| active | Boolean | 是否启用 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### sessions（会话）— 极简化

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Int (auto-increment) | 主键 |
| uuid | String (UUID) | 对外标识，与 SDK sessionId 保持一致 |
| projectId | Int → projects.id | 所属项目 |
| title | String | 会话标题（默认"新会话"） |
| status | String | active / completed |
| filePath | String? | 指向 SDK JSONL 文件的路径 |
| lastMessageAt | DateTime? | 最后消息时间 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

> **消息读取方式：** 通过 SDK 的 `getSessionMessages(sessionId)` 读取，不走数据库
> **级联删除：** projectId 关联 `onDelete: Cascade`，删除项目时级联清理 sessions

### assets（资产）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Int (auto-increment) | 主键 |
| uuid | String (UUID) | 对外标识 |
| sessionId | Int → sessions.id | 所属会话 |
| projectId | Int? → projects.id | 所属项目（可选，可直接关联 session） |
| type | String | prd / jira_task |
| title | String | 资产标题 |
| content | String | 资产内容（Markdown） |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

## 验收标准

- [ ] Prisma Schema 定义完成，4 张表关系正确，使用 INT 自增 PK + UUID 字段
- [ ] `npx prisma migrate dev` 成功生成迁移文件
- [ ] `npx prisma generate` 成功生成 TypeScript Client
- [ ] 测试数据 seed 脚本可用（测试账号 admin / oceanus123）
- [ ] sessions.filePath 配置正确，messages 不由 DB 管理

## 技术要点

- 使用 PostgreSQL 数据库
- 所有表使用 UUID 主键
- 使用 Prisma 的 `@updatedAt` 自动管理更新时间
- 会话消息由 SDK JSONL 管理，DB 不做消息持久化
