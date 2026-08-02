# Brainstorming Session 2026-08-02-001

> ⚠️ **术语时间线提示：** 本文档为需求讨论阶段的历史记录，其中 `nameEn` 在后续实现中改名为 `projectName`、`name` 改名为 `displayName`。实际字段名以 `projectName` / `displayName` 为准。

> 对应 OpenSpec change：`session-partition-project-user`

## 讨论主题

会话按 **（项目 × 用户）隔离** —— 重构会话管理的数据模型与存储分区，使会话只属于其创建者。为多项目、多用户下的会话隔离打地基，并顺手消除既有隐患。

## 背景与痛点

- 当前会话管理**只用 `resume`**（无 continue），且所有用户的会话混在同一个全局 `FileSystemSessionStore(data/sessions)` 里，用户之间无隔离。
- **隐患 bug**：`session.service.ts` 的清理路径约定（`data/sessions/{projectId}/`）与 SDK 实际落盘路径（`data/sessions/{sanitized-cwd}/`）不匹配 → 删会话不删 JSONL，残留垃圾文件。
- **安全缺口**：`POST /chat` 信任客户端传入的 `projectId`，服务端无校验；分区后改由服务端解析，缺口一并关闭。

## 关键决策

| #   | 决策点             | 结论                                                                               |
| --- | ------------------ | ---------------------------------------------------------------------------------- |
| 1   | 分区维度           | （项目 nameEn × 用户 username）两层结合                                            |
| 2   | 项目标识           | `nameEn` 英文 slug：`^[a-z][a-z0-9_-]*$`，输入不区分大小写 → 统一存小写，`@unique` |
| 3   | 用户标识           | `username`（沿用现有字段；JWT payload / `req.user.username` 已就绪）               |
| 4   | 用户中文名         | `displayName` 必填                                                                 |
| 5   | 共享会话           | **不存在**；项目内每人独立会话，无 scope 字段                                      |
| 6   | 成员管理           | 先不做；建项目自动把创建者设为 owner；角色 = `owner` + `member`                    |
| 7   | ProjectMember 外键 | `username`（全链路一致，不用 userId）                                              |
| 8   | continue           | **连后端接口也不做**；仅保证分区后 resume 天然被隔离                               |
| 9   | 迁移策略           | 开发期直接重建，不兼容旧数据                                                       |
| 10  | Session.filePath   | **删除**；路径由 (nameEn, username, sdkSessionId) 推导，单一事实来源               |
| 11  | 路由标识           | 项目/会话路由切到 nameEn（如 `projects/:nameEn/sessions`）                         |
| 12  | 项目权限           | owner 可删改，member 只读                                                          |

## Postgres 存储转向（grill-me 收敛）

讨论中用户贴出 SDK 官方 `SessionStore` 持久化文档并拍板：**会话信息直接放数据库**，从文件系统 JSONL 镜像迁到 Postgres。随之通过 8 轮 grill 收敛了以下子决策：

| #   | 决策点       | 结论                                                                                                                                                                                                                                                                                                                |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | 存储目标     | Postgres `SessionEntry` 模型（映射 `claude_session_entries` 表），**模型统一由 Prisma 维护管理**（未上线，直接修改初始迁移脚本 `migration.sql` 重建，无增量迁移）；官方 `PostgresSessionStore.ts` 仅作**接口契约 + 行为语义参考**，存储后端用 PrismaClient 自写 `PrismaSessionStore`；**不引入** `pg` / `@types/pg` |
| 14  | 记录建模     | 每 entry 一行：`id BIGSERIAL`（排序）+ `uuid`（SDK 幂等键，append 去重）+ `partitionKey` + `sessionId` + `subpath` + `entry JSONB` + `createdAt`（Prisma `Json` → JSONB）                                                                                                                                           |
| 15  | 分区方式     | **每个 (nameEn × username) 一个 store 实例**，`partitionKey` 填 `${nameEn}/${username}`（忽略 SDK 的 cwd-derived projectKey），DB 层物理隔离（纵深防御）。**NOTE**: `partitionKey` ≠ `nameEn`（slug），`/username` 后缀是用户隔离关键                                                                               |
| 16  | 本地副本     | agent env 设 `CLAUDE_CONFIG_DIR` → 临时目录即弃，Postgres 为唯一权威副本                                                                                                                                                                                                                                            |
| 17  | 续传分区解析 | 新会话首条消息必传 `projectName`；续传/确认/取消从 Session 记录推导分区（会话记录是唯一事实来源）                                                                                                                                                                                                                   |
| 18  | 越权语义     | 非成员项目 / 非所有者会话 / 资产，一律 **404 统一不存在**（不泄露资源存在性）                                                                                                                                                                                                                                       |
| 19  | Asset 隔离   | asset 四个端点（listBySession / getById / download / copy）补所有权校验                                                                                                                                                                                                                                             |
| 20  | 外键策略     | `SessionEntry` 的 `sessionId` **不设硬外键**（规避 SDK append 先于 Session 懒创建的时序竞态）；删除由服务层 Prisma `$transaction` **原子清理**：删会话按 `(partition, sessionId)`，删项目按 `partitionKey LIKE '${nameEn}/%'`（删除项目时 `ProjectMember` 一并级联清理）                                            |

## 需求要点

- 会话存储迁到 Postgres，`SessionEntry` 模型统一由 Prisma 维护（`prisma migrate`）；每个 (项目 nameEn × 用户 username) 一个 `PrismaSessionStore` 实例，`partitionKey` = `${nameEn}/${username}`，DB 层物理隔离。
- `partitionKey`（分区键）≠ `nameEn`（项目 slug）：分区键 = nameEn + '/' + username，二者不合并命名，文档统一说明关系。
- 认证 → 分区链：JWT → `req.user.username` → 查 Project(nameEn) → 校验 ProjectMember → 构建 scoped store。
- 新会话首条消息必须带 `projectName`（nameEn）；续传/确认/取消从 Session 记录推导分区并做所有权校验。
- 会话列表 / 详情 / 删除 / 资产按 `username` 过滤与校验 —— 隔离的关键，非所有者一律 404。
- 项目列表只返回当前用户是成员的项目；owner 删改、member 只读。
- `POST /chat` 去掉客户端可伪造的 `projectId`，改传 `projectName`，服务端解析分区。

## 边界范围（不做）

- continue 触发能力（前端入口 + 后端接口都暂不做）
- 成员管理（邀请 / 移除 / 角色变更的 UI 与接口）
- 共享会话 / 团队会话
- username 改名（自然键 FK 约束，当前无此功能）
- 跨设备会话恢复
- 存量数据迁移（开发期直接重建）

## 后续步骤

1. 进入 Stage 3（openspec SDD）：proposal → specs → design → tasks → spec-hardener → writing-plans（proposal 已产出，grill 收敛，待 specs）。
2. 实现阶段重点验证：
   - 同项目两用户分区隔离（A 看不到 B 的会话，`claude_session_entries` 记录互不交叉）
   - 非成员访问项目/会话/资产 → 404
   - 删除会话/项目正确清理 `claude_session_entries`（无孤儿记录）
   - `PrismaSessionStore` 通过 SDK conformance 套件
   - slug 校验 + 小写归一
