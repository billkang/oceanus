## Why

当前所有用户的会话混在同一个全局 `FileSystemSessionStore(data/sessions)` 中，无用户/项目隔离，任何人拿到 `sdkSessionId` 即可访问他人会话；`POST /chat` 信任客户端传入的 `projectId`，无服务端校验。同时会话镜像落在文件系统，清理路径与真实落盘不匹配，删会话残留孤儿 JSONL 文件。

本次将会话存储**从文件系统镜像迁到 Postgres**，由 Prisma `SessionEntry` 模型统一管理（自写 `PrismaSessionStore` 适配器实现 SDK `SessionStore` 接口，不引入独立数据库客户端），并按（项目 × 用户）分区隔离会话，使会话只属于其创建者。隔离双层落地：DB 层 `partitionKey` 物理分区 + 服务层所有权校验。

## What Changes

- **BREAKING** 会话存储策略：文件系统 JSONL 镜像 → Postgres，由 Prisma `SessionEntry` 模型统一管理（每 entry 一行：`id BIGSERIAL` + `uuid`（SDK 幂等键，append 去重）+ `partitionKey` + `sessionId` + `subpath` + `entry JSONB` + `createdAt`，覆盖索引 `(partitionKey, sessionId, subpath, id)`）。自写 `PrismaSessionStore` 适配器实现 SDK `SessionStore` 接口；项目未上线，直接修改初始迁移脚本 `migration.sql` 重建开发库，不维护增量迁移；不引入 `pg` / `@types/pg`。
- **BREAKING** 分区机制：每个（项目 projectName × 用户 username）一个 `PrismaSessionStore` 实例，`partitionKey` 填 `${projectName}/${username}`（忽略 SDK 传入的 cwd-derived projectKey），DB 层物理隔离。**NOTE**: `partitionKey`（分区键）≠ `projectName`（项目唯一标识）：分区键 = projectName + '/' + username，`/${username}` 后缀是用户隔离的关键，二者不合并命名，文档统一说明关系。
- **BREAKING** 本地副本策略：agent env 设 `CLAUDE_CONFIG_DIR` 指向临时目录即弃，Postgres 成为唯一权威副本，服务器磁盘零累积。
- **BREAKING** `Project` 新增 `projectName` 唯一标识（`^[a-z0-9][a-z0-9_-]*$`，输入转小写），作为项目公共标识。
- **BREAKING** `User.displayName` 改为必填。
- **BREAKING** 新增 `ProjectMember`（`projectId` + `username` + `role`，外键用 `username`），建项目自动把创建者设为 owner。
- **BREAKING** `Session` 新增 `username` 归属人，删除冗余 `filePath` 字段。
- **BREAKING** 项目/会话路由切到 `projectName`（如 `projects/:projectName/sessions`）。
- **BREAKING** `POST /chat` 请求体 `projectId` → `projectName`，服务端解析分区并校验成员资格。
- 隔离机制：新会话首条消息必须带 `projectName`；续传 / 确认 / 取消从 Session 记录推导分区（会话记录是唯一事实来源）；会话列表 / 详情 / 删除 / 资产按所有权校验，非所有者一律 404（不泄露资源存在性）。
- 项目列表只返回当前用户是成员的项目；owner 可删改、member 只读。
- Asset 四个端点补所有权校验（通过 asset → session → username）。
- 删除清理：删会话按 `(partition, sessionId)` 清 `SessionEntry`（无 FK 级联，规避 append 先于 Session 创建的时序竞态）；删项目按 `partitionKey LIKE '${projectName}/%'` 一次清空所有用户分区。
- 开发期直接重建数据库，不兼容旧数据。

## Out of Scope

- continue 触发能力（前端入口 + 后端接口都暂不做）。
- 成员管理（邀请 / 移除 / 角色变更的 UI 与接口）；仅建项目自动设 owner。
- 共享会话 / 团队会话。
- username 改名（自然键 FK 约束）。
- 跨设备会话恢复。
- 存量数据迁移（项目未上线，直接重建，不兼容旧数据）。
- 会话列表分页（当前规模不需要）。

## Capabilities

### New Capabilities

- `session-partitioning`: 按（项目 × 用户）分区隔离会话与资产，Postgres 存储（Prisma `SessionEntry` 模型）+ DB 层 `partitionKey` 分区 + 服务层所有权校验

### Modified Capabilities

- `session-management`: Session 新增 `username` 归属、删除 `filePath`、改用 Postgres 存储、删除时显式清理会话记录
- `project-management`: 新增 `projectName` 标识、`ProjectMember` 成员与角色、项目列表按成员过滤、owner 删改 / member 只读
- `user-auth`: `displayName` 改为必填
- `chat-streaming`: 请求体 `projectId` → `projectName`，续传从会话记录推导分区
- `asset-panel`: 四个端点补所有权校验

## Impact

- **后端**：`prisma/schema.prisma`（User / Project / ProjectMember / Session / SessionEntry，无 SessionRecord 模型）、`agent/stores/` 新增 `prisma.store.ts`（自写 `PrismaSessionStore` 实现 SDK `SessionStore`，删除 `file-system.store.ts`）、`agent/agent.service.ts`（store 实例化 + `CLAUDE_CONFIG_DIR` env）、`chat/chat.{controller,service}.ts` 及 DTO、`session/session.{controller,service}.ts`、`project/project.{controller,service}.ts` 及 DTO、`asset/asset.{controller,service}.ts`、seed 脚本。
- **前端**：项目类型增加 `projectName`，session-list / chat 改用 `projectName` 传参。
- **API**：`POST /chat` 请求体变更（**BREAKING**）；项目/会话路由 `:id` → `:projectName`（**BREAKING**）。
- **数据**：项目未上线，开发期直接修改初始迁移脚本重建（无增量迁移），不兼容旧数据；DB 4 表 → 6 表（新增 `project_members`、`claude_session_entries`），全部由 Prisma schema 统一管理。
- **权限**：`ProjectMember` 成员校验 + Session / Asset 所有权校验，非所有者 404。
- **依赖**：不新增数据库客户端（复用 PrismaClient 实现 SessionStore 适配器）；`CLAUDE_CONFIG_DIR` 环境变量。

## Known Risks

- **SDK append 先于 Session 懒创建的时序竞态** → 无 FK + 服务层 `$transaction` 显式清理 + 数据库写入失败发 `error` 事件引导重试（详见 design D4）。
- **Prisma 逐 entry 写入吞吐低于裸 pg** → 会话数据低量、非热路径，可接受；必要时批量 `createMany` 兜底。
- **分区 store 实例生命周期** → 每次消息重建实例（无状态、廉价），暂不缓存，避免内存泄漏。

## Validation

- **后端**：`npm run build`（nest build）+ `npm run lint`（eslint）+ `npm test`（vitest run）全绿。
- **PrismaSessionStore**：`runSessionStoreConformance` 对 live Postgres 跑通 append/load/listSessions/delete/listSubkeys 全量语义。
- **数据重建**：`prisma migrate reset` + `prisma db seed` 后可运行。
- **手工验证**：同项目两用户分区隔离（A 看不到 B 的会话，`claude_session_entries` 记录互不交叉）；非成员/非所有者访问 → 404；删除会话/项目正确清理 `SessionEntry`（无孤儿）。

## Known Limitations

- **username 自然键锁定**：`partitionKey` 与 `ProjectMember` 均依赖 username 不变；将来支持改名/删号需迁移分区与成员关系（当前列为 Non-Goal）。
- **SessionEntry 无 FK 依赖服务层清理**：任何绕过服务层的手动 SQL / 脚本删除会留下孤儿记录；当前所有删除路径均收敛在 service 的 `$transaction`。
- **404 统一语义的排查成本**：越权一律 404，业务侧难以区分"不存在"与"无权限"，排查需查服务端日志（原因仅记录日志）。
- **首条消息依赖前端可靠传 projectName**：`__new__` 占位 + 路由 projectName；页面刷新若丢失项目上下文则首条消息无法发送（前端需从路由持久获取 projectName）。
- **分区 store 每次消息重建**：实例无状态、构造廉价；若未来 store 变重（连接池/缓存）需引入按分区缓存。
