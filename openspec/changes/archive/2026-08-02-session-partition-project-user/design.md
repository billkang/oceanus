# Design — 会话按（项目 × 用户）分区隔离 + Postgres 存储

## Context

当前 Oceanus 的会话管理存在四个问题：

1. **无隔离**：所有用户的所有会话混在同一个全局 `FileSystemSessionStore(data/sessions)` 里（`agent.service.ts:44`），任何人拿到 `sdkSessionId` 即可访问他人会话；SDK 的 `projectKey` 由 cwd 派生（所有请求相同），没有租户语义。
2. **信任客户端**：`chat.controller.ts` 把 `projectId` 原样透传给 `chat.service.ts`，后者用 `projectId ? Number(projectId) : 1` 兜底创建 Session——客户端可伪造归属项目。
3. **文件镜像残留**：会话镜像 JSONL 落盘，但 `session.service.ts` 的清理路径约定（`data/sessions/{projectId}/`）与 SDK 实际落盘路径（`data/sessions/{sanitized-cwd}/`）不匹配 → 删会话残留孤儿文件；`lastMessageAt` 只有读取（`session.service.ts:22` 排序）没有任何写入点，列表排序是空头。
4. **模型游离**：若沿用官方 `PostgresSessionStore.ts`（裸 `pg` + `ensureSchema()`），会话记录表会在 Prisma 视野之外，违背"模型统一由 Prisma 维护管理"。

本次变更把会话存储迁到 Postgres，并按（项目 × 用户）分区隔离，隔离双层落地：DB 层 `partitionKey` 物理分区 + 服务层所有权校验。会话模型统一进 Prisma。

## Goals / Non-Goals

**Goals:**

- 会话只属于其创建者：按（项目 projectName × 用户 username）物理分区存储，`partitionKey = ${projectName}/${username}`。
- 会话记录表（`claude_session_entries`）作为 Prisma `SessionEntry` 模型统一管理，经 `prisma migrate` 维护（项目未上线，直接改初始迁移脚本，无增量迁移）。
- 认证 → 分区链路：JWT `req.user.username` → 查 `Project(projectName)` → 校验 `ProjectMember` → 构建 scoped store。
- 越权访问统一 404（不泄露资源存在性）。
- Asset 四个端点补所有权校验（`asset → session → username`）。
- `POST /chat` 去掉客户端可伪造的 `projectId`，改传 `projectName`，服务端解析分区。

**Non-Goals:**

- continue 触发能力（前端入口 + 后端接口都暂不做）。
- 成员管理（邀请 / 移除 / 角色变更的 UI 与接口）；仅建项目自动设 owner。
- 共享会话 / 团队会话。
- `username` 改名（自然键 FK 约束）。
- 跨设备会话恢复。
- 存量数据迁移（开发期直接重建，不兼容旧数据）。
- 会话列表分页（当前规模不需要）。

## Decisions

### D1. 存储后端：Prisma `SessionEntry` 模型 + 自写 `PrismaSessionStore` 适配器

`SessionStore` 接口（`append` / `load` / `listSessions` / `delete` / `listSubkeys`）与 `SessionKey` 从 `@anthropic-ai/claude-agent-sdk` 导入，精确实现；行为语义参照官方 `PostgresSessionStore` 参考实现（每 entry 一行、`load` 按 `id` 升序、`delete` 主记录级联子路径、`listSessions` 按 session_id 分组取 mtime、NULL 子路径匹配）。存储后端用项目既有 `PrismaClient` 读写。

- Prisma `Json` 字段映射 Postgres JSONB，天然匹配 `entry`。
- 表结构（schema.prisma 声明）：
  ```prisma
  model SessionEntry {
    id           BigInt   @id @default(autoincrement())
    uuid         String?  // SDK entry 幂等键，append 去重（防重试重复行）
    partitionKey String
    sessionId    String
    subpath      String?
    entry        Json
    createdAt    DateTime @default(now())
    @@index([partitionKey, sessionId, subpath, id])
    @@map("claude_session_entries")
  }
  ```
- 不引入 `pg` / `@types/pg`。`file-system.store.ts` 删除，由 `prisma.store.ts` 取代。
- 适配器通过 conformance 套件验证（`runSessionStoreConformance`，随实现引入，针对 live Postgres）。

**替代方案**：拷贝官方 `PostgresSessionStore.ts` + `pg`——表结构 `ensureSchema()` 自管，游离 Prisma 之外，违背"模型统一 Prisma"，被否。

### D2. 分区键：`partitionKey = ${projectName}/${username}`，忽略 SDK 的 cwd-derived key

SDK 的 `projectKey` 由 cwd 派生（`Jr(cwd) = us(cW(cwd))`），无法按 query 覆盖；SDK 的 `SessionStore` 回调一律携带该 key。因此**每个（projectName × username）一个 store 实例**，实例构造时把 `partitionKey` 固定为 `${projectName}/${username}`，所有接口忽略 `key.projectKey` 参数。

- `partitionKey ≠ projectName`：`projectName` 是项目唯一标识，分区键是 `projectName + '/' + username`，`/username` 后缀实现用户级存储隔离（纵深防御）。

**替代方案**：分区键只取 projectName——同项目用户 A、B 的 store 共享同一 key，`listSessions` 互见彼此会话，用户隔离只剩服务层一道，被否。

### D3. 分区解析：首条必传 `projectName`，续传/确认/取消从 Session 记录推导

- **新会话首条消息**：请求体必带 `projectName`（项目 projectName）→ 查项目 → 校验 `ProjectMember`（非成员 404）→ 以 `(projectName, req.user.username)` 构建分区 → `SDK.query()` 不带 resume。
- **续传 / 确认 / 取消**：请求带 `sessionId` → 查 Session 记录 → 校验 `session.username === 当前用户`（非所有者 404）→ 从 `session.project.projectName` 与 `session.username` 推导分区 → `SDK.query({ resume })`。Session 记录是唯一事实来源，客户端无需再传项目标识。

### D4. 无硬外键 + 服务层 `$transaction` 原子清理

`SessionEntry.sessionId` 保持普通字符串、**不设 FK**（规避 SDK append 先于 Session 懒创建的时序竞态——首条消息时 SDK 先落 entry，`system/init` 后才懒建 Session 记录）。删除由服务层显式清理，且因为 SessionEntry / Session / Project 全在 Prisma，统一走 `$transaction`：

- 删会话：`$transaction([sessionEntry.deleteMany({ partitionKey, sessionId }), session.delete({ sdkSessionId })])`。
- 删项目：`$transaction([sessionEntry.deleteMany({ partitionKey: { startsWith: projectName + '/' } }), project.delete])`（项目级联 ProjectMember / sessions / assets）。

失败整体回滚，不留半删状态。

### D5. 统一 404 语义

非成员项目 / 非所有者会话 / 非所有者资产，一律返回 404（"不存在"与"无权限"不区分）。区别原因仅记录服务端日志。

### D6. 本地副本即弃

`SDK.query()` 的 env 设 `CLAUDE_CONFIG_DIR` 指向临时目录，agent 子进程的本地会话副本即弃，Postgres 为唯一权威副本，服务器磁盘零累积。`sessionStore` 不可与 `persistSession: false` / `enableFileCheckpointing` 组合（SDK 约束）。

### D7. 命名收敛（用户决策）

- 保留 `projectName`，**不重命名**为 project_key（二者非同一概念，见 D2）。
- 存储分区列命名 `partitionKey`，与项目字段 `projectName` 区分。
- 手动创建会话端点删除（POST `/projects/:projectName/sessions`），会话一律首条消息懒创建。

### D8. `lastMessageAt` 补写入

`chat.service.ts` 的 `afterStreamComplete` 管线补首步：更新 `Session.lastMessageAt = now`，管线变为 **更新 lastMessageAt → 标题更新 → PRD 自动提取**。会话列表排序才有真实依据。

### D9. 无迁移：直接改初始脚本

项目未上线，直接修改初始迁移脚本 `prisma/migrations/*/migration.sql` + `seed.ts` 重建开发库，不维护增量迁移历史。

## Change Scope Matrix

| 能力                 | 模块 / 文件                                                           | 变更类型   | 内容                                                                                                            |
| -------------------- | --------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| session-partitioning | `server/prisma/schema.prisma`                                         | modify     | 新增 `SessionEntry` 模型（无 FK）；User / Project / ProjectMember / Session 调整（见 D0-D9）                    |
| session-partitioning | `server/src/agent/stores/prisma.store.ts`                             | **add**    | `PrismaSessionStore` 实现 SDK `SessionStore`（append/load/listSessions/delete/listSubkeys），分区键固化         |
| session-partitioning | `server/src/agent/stores/file-system.store.ts`                        | **delete** | 移除文件系统镜像存储                                                                                            |
| session-partitioning | `server/src/agent/agent.service.ts`                                   | modify     | 移除共享 `FileSystemSessionStore`；新增按分区构建 store 的方法；`query()` 注入 `CLAUDE_CONFIG_DIR` 临时目录 env |
| session-partitioning | conformance 套件（如 `server/src/agent/stores/prisma.store.spec.ts`） | **add**    | `runSessionStoreConformance` 验证适配器（live Postgres）                                                        |
| session-management   | `server/prisma/schema.prisma`                                         | modify     | `Session` 增 `username`、删 `filePath`；`sdkSessionId @unique` 保留                                             |
| session-management   | `server/src/session/session.service.ts`                               | modify     | 创建带 username；列表按 username 过滤 + 项目 projectName；删除改 `$transaction` 清 SessionEntry；移除 JSONL 清理逻辑 |
| session-management   | `server/src/session/session.controller.ts`                            | modify     | 路由 `:projectId` → `:projectName`；删 POST 创建端点；详情/删除/历史消息所有权校验                                   |
| project-management   | `server/prisma/schema.prisma`                                         | modify     | `Project` 增 `projectName @unique`；新增 `ProjectMember`（projectId + username + role，username 自然键 FK）          |
| project-management   | `server/src/project/project.service.ts`                               | modify     | 创建自动写 owner ProjectMember；列表按成员过滤；详情/删改按 projectName + owner 校验；删除清 SessionEntry            |
| project-management   | `server/src/project/project.controller.ts`                            | modify     | 路由 `:id` → `:projectName`                                                                                          |
| project-management   | `server/src/project/dto/create-project.dto.ts`                        | modify     | 增 `projectName` 校验（`^[a-z0-9][a-z0-9_-]*$` + 小写归一）                                                             |
| user-auth            | `server/prisma/schema.prisma` + `seed.ts`                             | modify     | `User.displayName` 必填；seed 账号带 displayName；auth 不再回退 username                                        |
| chat-streaming       | `server/src/chat/dto/chat-request.dto.ts`                             | modify     | `projectId` → `projectName`（string）                                                                           |
| chat-streaming       | `server/src/chat/chat.service.ts`                                     | modify     | `sendAndStream` 分区解析 + 成员/所有权校验；`afterStreamComplete` 补 lastMessageAt                              |
| asset-panel          | `server/src/asset/asset.controller.ts`                                | modify     | listBySession / getById / download / copy 四端点补所有权校验（asset → session → username，非所有者 404）        |
| 数据                 | `server/prisma/migrations/*/migration.sql`                            | modify     | 直接重写初始脚本重建开发库（未上线无增量）                                                                      |
| 数据                 | `server/prisma/seed.ts`                                               | modify     | 项目 projectName + 自动 owner member；测试账号 displayName                                                           |

## API Contract

### 认证

`POST /api/v1/auth/login` — 不变。返回 `{ token, user: { id, username, displayName } }`，`displayName` 必填（不再回退 username）。

### 项目

| 方法   | 路由                | 鉴权  | 说明                                                                                                                    |
| ------ | ------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| GET    | `/projects`         | 成员  | 当前用户是成员的项目列表（含 sessionCount）                                                                             |
| POST   | `/projects`         | 登录  | body `{ displayName, projectName, description? }`；projectName 校验 `^[a-z0-9][a-z0-9_-]*$` 小写归一；自动创建 owner ProjectMember          |
| GET    | `/projects/:projectName` | 成员  | 详情；非成员 404                                                                                                        |
| PATCH  | `/projects/:projectName` | owner | 改 displayName / description；projectName 不可改；非 owner 404                                                                      |
| DELETE | `/projects/:projectName` | owner | `$transaction` 清 SessionEntry（`partitionKey LIKE '${projectName}/%'`）+ 级联删 ProjectMember/sessions/assets；非 owner 404 |

### 会话

| 方法   | 路由                               | 鉴权   | 说明                                                                                    |
| ------ | ---------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| GET    | `/projects/:projectName/sessions`       | 成员   | 当前用户会话列表（lastMessageAt DESC, createdAt DESC）                                  |
| GET    | `/sessions/:sdkSessionId`          | 所有者 | 详情（含项目信息）；非所有者 404                                                        |
| DELETE | `/sessions/:sdkSessionId`          | 所有者 | `$transaction` 清 SessionEntry（`partitionKey, sessionId`）+ Session 记录；非所有者 404 |
| GET    | `/sessions/:sdkSessionId/messages` | 所有者 | SDK 历史消息（走 scoped store）；非所有者 404                                           |

### 聊天（SSE）

`POST /api/v1/chat`，body `{ action, content?, sessionId?, projectName?, confirmOption?, model? }`：

- `action: message` + 无 `sessionId`（新会话）：**必带 `projectName`**（缺少 → 400）；非成员 → 404；服务端 `(projectName, username)` 构建分区，`SDK.query()` 不带 resume；首事件 `session_created`。
- `action: message` + 有 `sessionId`（续传）：从 Session 记录推导分区 + 所有权校验（非所有者 404）；`SDK.query({ resume })`。
- `action: confirm` / `cancel`：需 `sessionId`；同样从 Session 记录推导分区 + 所有权校验。
- 错误：400（空消息 / 缺 projectName / 缺 confirmOption）/ 404（会话不存在或非所有者）/ 401（Token）。

### 资产

| 方法 | 路由                          | 鉴权       | 说明                   |
| ---- | ----------------------------- | ---------- | ---------------------- |
| GET  | `/sessions/:sessionId/assets` | 会话所有者 | 资产列表；非所有者 404 |
| GET  | `/assets/:id`                 | 资产所有者 | 详情；非所有者 404     |
| GET  | `/assets/:id/download`        | 资产所有者 | 下载 .md；非所有者 404 |
| POST | `/assets/:id/copy`            | 资产所有者 | 返回内容；非所有者 404 |

所有权链路：`asset → session → username`（schema 中 Asset.sessionId 非空）。

## Risks / Trade-offs

- **[Prisma 逐 entry 写入吞吐低于裸 pg]** → 会话数据低量（每条消息数十 entry），且非热路径，可接受；必要时批量 `createMany`。
- **[SDK append 先于 Session 懒创建的孤儿 entry]** → 无 FK 约束 + 服务层 `$transaction` 显式清理 + 数据库写入失败发 `error` 事件引导重试。
- **[Prisma `listSessions` 的 groupBy / mtime 语义与官方 conformance 有差异]** → 实现按 conformance 套件逐一验证（groupBy + `_max.createdAt`、`id` 升序）。
- **[分区 store 实例生命周期]** → 实例无状态（仅持有 PrismaClient + partitionKey），每次消息构建新实例即可，无需缓存 Map（避免内存泄漏）。
- **[`ProjectMember` 用 username 自然键]** → username 不可改名（列入 Non-Goals）；账号删除需级联清理 ProjectMember（当前无此功能）。
- **[直接重写初始迁移脚本]** → 未上线，无回滚诉求；开发库随时可 `migrate reset` 重建。
- **[`CLAUDE_CONFIG_DIR` 指向临时目录]** → 需确保目录可写且跨请求唯一（按 partition + 时间戳生成）。

## Migration Plan

项目未上线，不写迁移脚本：

1. 修改 `schema.prisma`（SessionEntry / ProjectMember / projectName / username / displayName 必填）。
2. 直接重写初始迁移脚本 `prisma/migrations/*/migration.sql`，`prisma migrate reset` 重建开发库。
3. 更新 `seed.ts`（项目 projectName + owner member + 测试账号 displayName），`prisma db seed`。
4. 回滚：数据库重建即可，无历史包袱。

## Open Questions

1. **分区 store 实例生命周期**：每次消息构建新 `PrismaSessionStore`（无状态，推荐）vs 按 `(projectName, username)` 缓存复用 → 设计倾向每次构建，实现时定。
2. **conformance 套件落点**：独立 `shared/conformance.ts`（供多个 store 复用）vs 直接写在 `prisma.store.spec.ts` 内 → 实现时按现有测试组织定。

> `GET /sessions/:sdkSessionId/messages` 所有权校验已定案：纳入（`session.username === 当前用户`，非所有者 404，走 scoped store），spec 已补场景。
