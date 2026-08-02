# session-partitioning Specification

## Purpose

会话分区能力：会话存储按（项目 × 用户）物理分区，隔离会话与资产，使会话只属于其创建者。

## ADDED Requirements

### Requirement: 会话存储分区

系统 SHALL 将会话记录按（项目 × 用户）物理分区存储于 Postgres，分区键为 `${projectName}/${username}`。

#### Scenario: 分区物理隔离

- **WHEN** 两个用户 A、B 同属项目 P
- **THEN** A 的会话记录 `project_key = 'P/a'`，B 的会话记录 `project_key = 'P/b'`
- **THEN** 两分区的记录互不交叉，按分区寻址的查询只能命中本分区

#### Scenario: 分区键来源

- **WHEN** 系统为某次查询构建会话存储
- **THEN** 分区键 = 项目 `projectName` + 当前认证用户 `username`，即 `${projectName}/${username}`
- **THEN** SDK 传入的 cwd-derived `projectKey` 被忽略，一律使用该分区键
- **NOTE**: 分区键 ≠ 项目标识 `projectName`：`projectName` 是项目唯一标识；分区键 = `projectName + '/' + username`，`/username` 后缀实现用户级隔离

### Requirement: PrismaSessionStore 适配器

系统 SHALL 使用基于 Prisma 的 `SessionStore` 适配器（`PrismaSessionStore`），将会话记录镜像到 Prisma `SessionEntry` 模型（`claude_session_entries` 表）。接口契约与行为语义参照 SDK 官方 `PostgresSessionStore` 参考实现，存储后端用项目既有 PrismaClient；表结构经 `prisma migrate` 统一管理，不引入独立数据库客户端。

#### Scenario: 表结构与索引

- **WHEN** 系统重建开发数据库（项目未上线，直接修改初始迁移脚本 `migration.sql` 重新执行，不维护增量迁移）
- **THEN** `SessionEntry` 模型表结构为：`id BIGSERIAL PRIMARY KEY`、`uuid TEXT`（SDK entry 幂等键，可空，append 去重）、`partitionKey TEXT NOT NULL`、`sessionId TEXT NOT NULL`、`subpath TEXT`、`entry JSONB NOT NULL`、`createdAt TIMESTAMPTZ`（Prisma `Json` 字段映射 Postgres JSONB）
- **THEN** 覆盖索引 `(partitionKey, sessionId, subpath, id)` 就绪

#### Scenario: 追加与读取

- **WHEN** SDK 调用 `append(key, entries)`
- **THEN** 每个 entry 作为一行写入（`partitionKey` 用分区键，entry 序列化为 JSONB）
- **WHEN** SDK 调用 `load(key)`
- **THEN** 按 `(partitionKey, sessionId, subpath)` 命中，按 `id` 升序返回全部 entry

#### Scenario: 删除级联子路径

- **WHEN** SDK 调用 `delete(key)` 且 `subpath` 未定义（主记录）
- **THEN** 删除该 `(partitionKey, sessionId)` 下所有子路径记录
- **WHEN** `subpath` 有值
- **THEN** 仅删除该子路径记录

### Requirement: 分区解析

系统 SHALL 在每次消息请求中解析会话分区：新会话由客户端提供项目标识，续传/确认/取消从会话记录推导。

#### Scenario: 新会话首条消息

- **WHEN** 用户发送新会话首条消息（无 `sessionId`）
- **THEN** 请求体必须携带 `projectName`（项目 projectName）
- **THEN** 服务端校验当前用户是该项目成员（非成员返回 404）
- **THEN** 以 `(projectName, username)` 构建分区

#### Scenario: 续传/确认/取消

- **WHEN** 用户对已有会话发送续传消息、确认选择或取消（携带 `sessionId`）
- **THEN** 服务端以 `sessionId` 查会话记录，校验 `session.username === 当前用户`（非所有者返回 404）
- **THEN** 从 `session.project.projectName` 与 `session.username` 推导分区
- **THEN** 客户端无需携带项目标识

#### Scenario: 越权访问统一 404

- **WHEN** 请求涉及其他用户的会话、非成员项目、非所有者资产
- **THEN** 服务端统一返回 404（不区分"不存在"与"无权限"）
- **NOTE**: 区分原因仅记录服务端日志，不暴露给客户端

### Requirement: 本地副本即弃

系统 SHALL 将 agent 的本地会话副本指向临时目录，使 Postgres 成为唯一权威副本。

#### Scenario: 本地不累积

- **WHEN** agent 子进程写本地会话记录
- **THEN** 写入位置为 `CLAUDE_CONFIG_DIR` 指向的临时目录
- **THEN** 服务器持久目录不累积本地会话副本

### Requirement: 会话记录清理

系统 SHALL 在删除会话或项目时清理对应的 `SessionEntry` 记录（无数据库外键级联，靠服务层 Prisma `$transaction` 原子清理）。

#### Scenario: 删除会话清理记录

- **WHEN** 用户删除某会话
- **THEN** 服务端在单个 Prisma `$transaction` 中删除 `partitionKey = 该会话分区` 且 `sessionId = 该会话` 的 SessionEntry 记录与 Session 记录
- **THEN** 任一删除失败则整体回滚

#### Scenario: 删除项目清理记录

- **WHEN** 用户删除某项目
- **THEN** 服务端在单个 Prisma `$transaction` 中删除 `partitionKey LIKE '${projectName}/%'` 的 SessionEntry 记录与项目记录（项目级联删除 sessions）
- **THEN** 任一删除失败则整体回滚
