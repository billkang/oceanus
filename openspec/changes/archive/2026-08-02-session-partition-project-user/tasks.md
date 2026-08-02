# Tasks — session-partition-project-user

## 1. Prisma 数据层（schema + 初始脚本 + seed）

- [x] 1.1 修改 `server/prisma/schema.prisma`：`User.displayName` 改必填；`Project` 增 `projectName @unique` 与 `members ProjectMember[]` 关系；新增 `ProjectMember`（projectId + username 自然键 FK + role，`@@unique([projectId, username])`，onDelete: Cascade）；`Session` 增 `username`、删 `filePath`；新增 `SessionEntry`（id BigInt + partitionKey + sessionId + subpath + entry Json + createdAt，覆盖索引 `(partitionKey, sessionId, subpath, id)`，**无 FK**，`@@map("claude_session_entries")`）
- [x] 1.2 重写初始迁移脚本 `server/prisma/migrations/*/migration.sql` 并 `prisma migrate reset` 重建开发库（项目未上线，无增量迁移）
- [x] 1.3 更新 `server/prisma/seed.ts`：测试账号 displayName 必填；项目带 projectName；建项目自动写 owner `ProjectMember`

## 2. PrismaSessionStore 适配器 + conformance

- [x] 2.1 新建 `server/src/agent/stores/prisma.store.ts`：`PrismaSessionStore implements SessionStore`，构造注入 PrismaClient + partitionKey（`${projectName}/${username}`），**忽略 `key.projectKey`**；实现 `append`（createMany）/ `load`（findMany id asc）/ `listSessions`（groupBy sessionId + `_max.createdAt`）/ `delete`（subpath 未定义级联子路径 / 有值仅删该路径）/ `listSubkeys`（distinct）
- [x] 2.2 引入 conformance 套件（`runSessionStoreConformance`），对 live Postgres 运行，验证适配器通过 append/load/listSessions/delete/listSubkeys 全量语义
- [x] 2.3 删除 `server/src/agent/stores/file-system.store.ts` 及其 spec

## 3. Agent 服务（分区 store + CLAUDE_CONFIG_DIR）

- [x] 3.1 `agent.service.ts`：移除共享 `FileSystemSessionStore`；新增 `createStore(partitionKey)` 按分区构建 `PrismaSessionStore`；`sendMessage` 增加 `partitionKey` / scoped store 注入，sessionOptions 不再引用全局 store
- [x] 3.2 `sendMessage` 的 env 增加 `CLAUDE_CONFIG_DIR` 指向临时目录（按分区 + 时间戳），agent 本地副本即弃，Postgres 为唯一权威副本
- [x] 3.3 `getSessionMessages` / `destroyAgent` 改为接收 scoped store（调用方按 sessionId 解析分区后传入）

## 4. Session 模块（隔离 + 分区寻址）

- [x] 4.1 `session.service.ts`：`create` 增加 username 归属；`listByProject` 改为按 projectName + username 过滤（非成员 404）；删除改 Prisma `$transaction`（`SessionEntry.deleteMany({ partitionKey, sessionId })` + `Session.delete`），移除 JSONL 清理逻辑；`getBySdkSessionId` 保留（含 `project.projectName`）
- [x] 4.2 `session.controller.ts`：路由 `:projectId` → `:projectName`（去 ParseIntPipe）；**删除 POST 创建端点**；GET 详情 / DELETE 删除补所有权校验（`session.username === 当前用户`，非所有者 404）

## 5. Project 模块（projectName + ProjectMember + 成员过滤）

- [x] 5.1 `create-project.dto.ts`：增 `projectName`（`^[a-z0-9][a-z0-9_-]*$`，输入转小写）
- [x] 5.2 `project.service.ts`：创建自动写 owner `ProjectMember`；`list` 按当前用户成员过滤；`getById/update/delete` 改按 projectName 寻址；update/delete 校验 owner（非 owner 404）；删除 `$transaction`（`SessionEntry.deleteMany({ partitionKey: { startsWith: projectName + '/' } })` + 项目级联删 ProjectMember/sessions/assets）
- [x] 5.3 `project.controller.ts`：路由 `:id` → `:projectName`（去 ParseIntPipe）

## 6. Auth（displayName 必填）

- [x] 6.1 `auth.service.ts`：移除 `displayName || username` 回退（displayName 必填）

## 7. Chat 模块（分区解析 + lastMessageAt）

- [x] 7.1 `chat-request.dto.ts`：`projectId` → `projectName`（string，新会话必传）
- [x] 7.2 `chat.service.ts`：`SendStreamOptions.projectId` → `projectName`；`sendAndStream` 分区解析——首条（无 sessionId）用 `projectName` 查项目 + 成员校验（非成员 404）构建分区；续传/确认/取消用 `sessionId` 查 Session 记录 + 所有权校验（非所有者 404）推导分区；移除 `projectId ? Number(projectId) : 1` hack
- [x] 7.3 `afterStreamComplete` 管线补首步：更新 `Session.lastMessageAt = now`（管线：更新 lastMessageAt → 标题更新 → PRD 提取）

## 8. Asset 模块（所有权校验）

- [x] 8.1 `asset.controller.ts` / `asset.service.ts`：listBySession / getById / download / copy 四端点补所有权校验（`asset → session → username`，非所有者 404）

## 9. 前端适配（projectName 路由 + projectName）

- [x] 9.1 `Project` 接口增 `projectName`；项目创建表单加 projectName 输入 + 校验；路由 `projects/:projectName`
- [x] 9.2 `project.service.ts`：getById/update/delete 用 projectName；create DTO 增 projectName
- [x] 9.3 `session.service.ts`：`listByProject(projectName)`；`Session` 接口删 filePath、增 username
- [x] 9.4 `chat.service.ts`：`sendMessage` options `projectId` → `projectName`（首条消息携带 projectName）
- [x] 9.5 `workspace.component.ts` / `chat.component.ts`：从路由 projectName 取项目标识，首条消息传递 projectName

## 10. 全量验证

- [x] 10.1 后端验证全绿：`npm run build`（nest build）+ `npm run lint`（eslint）+ `npm test`（vitest run）；`prisma migrate reset` + `prisma db seed` 后可运行
- [x] 10.2 手工验证：同项目两用户分区隔离（A 看不到 B 的会话，`claude_session_entries` 记录互不交叉）；非成员/非所有者访问 → 404；删除会话/项目正确清理 SessionEntry（无孤儿）；PrismaSessionStore 通过 conformance 套件
