# tasks — 产品工作流程规范化（project-workspace-isolation）

## 1. DB schema 软删改造

- [x] 1.1 `schema.prisma`：5 表（projects / sessions / project_members / session_entries / assets）各加 `deletedAt DateTime? @map("deleted_at")`
- [x] 1.2 `schema.prisma`：`Project.projectName` 移除 `@unique`，改为 `@@index([projectName], where: "(deleted_at IS NULL)", unique: true, name: "projects_projectName_active")`
- [x] 1.3 运行 `prisma db push` 同步开发库 + `prisma generate` 刷新 client（不生成迁移文件）
- [x] 1.4 schema 单测：软删后同名 projectName 可重建、活跃同名仍冲突

## 2. Session / Asset 软删查询过滤与级联

- [x] 2.1 `SessionService.listByProject` / `getBySdkSessionId` 查询补 `deletedAt: null`
- [x] 2.2 `SessionService.deleteBySdkSessionId`：物理删除改软删（$transaction 级联置 deletedAt：session → session_entries → assets）+ 会话目录进 `.trash/`
- [x] 2.3 `AssetService`：listBySession / getById / getContent 查询补 `deletedAt: null`
- [x] 2.4 Session / Asset 单测：已删项列表不可见、访问已删 404、级联软删

## 3. Workspace 模块（路径 / 骨架 / 会话目录 / 回收站）

- [x] 3.1 新建 `server/src/workspace/`：`WorkspaceConfig` 读取 `PROJECTS_ROOT` env（默认 `./projects`），`OnModuleInit` 自动建根
- [x] 3.2 `WorkspacePathBuilder` 纯函数：sessionDir / sharedPrdDir / trashPath + 标识符校验（拒绝 `..`、`/`、`\`、空），违反抛 `PathTraversalError`
- [x] 3.3 `WorkspaceService.createSkeleton(projectName)`：建 `requirements/shared/prd/`、`requirements/private/`、`repo/`，幂等；**残留目录处理**（项目根已有残留 → 先 rename 进 `.trash/`，rename 失败则创建失败）
- [x] 3.4 `WorkspaceService.ensureSessionDir`：mkdir 会话目录 + 建 `.claude/skills` symlink → 项目根 skills（幂等）
- [x] 3.5 `WorkspaceService.moveToTrash`：rename 到 `.trash/<原名>-<时间戳>`，首用自动建 `.trash/`，重名不覆盖，失败仅记日志
- [x] 3.6 Workspace 单测：路径构建、防穿越、骨架幂等、残留目录处理、trash 重名不覆盖

## 4. Skills 模块（SkillsProvider + spawn CLI）

- [x] 4.1 新建 `server/src/skills/`：`SkillsProvider` 接口（install / currentVersion / isOutdated）
- [x] 4.2 `DeepstormSkillsProvider`：spawn `deepstorm setup --non-interactive --tools tide`（cwd=项目目录）+ 超时（`SKILLS_INSTALL_TIMEOUT_MS`）
- [x] 4.3 `currentVersion` 读 `require.resolve('@deepstorm/cli/package.json').version`；spike 确认 pnpm 下 bin 解析路径
- [x] 4.4 版本标记：安装/刷新后写 `.claude/skills/.deepstorm-skills.json`（`{ installedVersion, installedAt }`）；isOutdated 比对标记
- [x] 4.5 spike：确认 `deepstorm setup` 完整写入面（是否含 settings.json/MCP；若超范围，改为只复制 `skills/` 子集）
- [x] 4.6 Skills 单测：install / 版本读取 / 标记读写 / mock CLI 失败路径

## 5. Agent 隔离（cwd / 白名单 / 去 Bash）

- [x] 5.1 `AgentService.sendMessage`：query() 加 `cwd`（会话目录）、`additionalDirectories: [shared/]`
- [x] 5.2 `AgentService`：oceanus-tide 提示词移除硬编码绝对路径（改为会话目录语义描述），保留网页环境适配指令
- [x] 5.3 `AgentService`：Agent 工具集去掉 `Bash`
- [x] 5.4 `AgentService`：新增 `buildPermissionHooks(sessionDir, sharedDir)` — PreToolUse 写白名单（Write/Edit 限会话目录、Read 限会话+shared），与 Langfuse hooks 合并注入
- [x] 5.5 集成测试：模拟 Agent 写 `shared/` → deny；写会话目录 → allow

## 6. Project 创建与软删

- [x] 6.1 `ProjectService.create` 重构（FS 先行）：唯一性预校验 → `createSkeleton`（失败抛错、DB 无副作用）→ DB `$transaction`（project + owner member）→ skills 安装（best-effort 失败不阻断）
- [x] 6.2 DB 阶段失败 best-effort 清理刚建骨架目录
- [x] 6.3 `ProjectService.delete`：软删级联 $transaction（project → members → sessions → session_entries（partitionKey 前缀）→ assets）+ 项目目录进 `.trash/`
- [x] 6.4 `ProjectService` 读查询过滤：list / getById / assertMember 补 `deletedAt: null`
- [x] 6.5 Project 单测：创建顺序、skills 失败不阻断、软删级联、已删 404、同名重建

## 7. Chat 流程集成（会话目录 + PRD 归档触发）

- [x] 7.1 spike：确认 TS SDK `session_id` 选项（覆盖自动生成、`system/init` 返回同一 id）
- [x] 7.2 `ChatService` 首条消息：预生成 UUID 作为 `sessionId` → `ensureSessionDir`（会话目录 + symlink + `SkillsProvider.isOutdated` 惰性刷新）→ 传入 `sendMessage` 以 `session_id` 注入 query
- [x] 7.3 `tryExtractPrd` 增加：PRD 落盘会话目录产出物
- [x] 7.4 `tryExtractPrd` 成功后调 `ArchiveService.onPrdExtracted(sessionId)` 触发去抖归档
- [x] 7.5 Chat 集成测试：会话目录在 query 前创建、PRD 落盘、归档触发信号

## 8. Archive 合并模块（去抖 / 域归并 / 独立调用 / mutex / 重试）

- [x] 8.1 新建 `server/src/archive/`：`ArchiveService.onPrdExtracted` + 去抖触发（内存 Map 记录 PRD hash + 连续 `ARCHIVE_DEBOUNCE_ROUNDS` 轮无变化才触发）
- [x] 8.2 域归并：合并前 `Glob shared/prd/*/`，prompt 提供已有域目录列表，模型决定复用或新建
- [x] 8.3 独立合并调用：`query()` tools=[Read,Write,Glob,Grep]、无 sessionStore/resume、cwd=项目 requirements 根、maxTurns 3-5、小预算上限
- [x] 8.4 per-domain mutex：进程内 `Map<domainPath, Promise>` 串行，并发同域排队，后到者基于前一轮结果继续
- [x] 8.5 有界重试：指数退避 3 次，仍失败标记 failed + 日志；PRD 原文双保险不丢（幂等）
- [x] 8.6 Archive 单测：去抖、幂等重试、mutex 串行、失败标记

## 9. 环境与验证

- [x] 9.1 server 依赖：`pnpm add @deepstorm/cli`
- [x] 9.2 `.env.example` 补充：PROJECTS_ROOT / SKILLS_INSTALL_TIMEOUT_MS / ARCHIVE_DEBOUNCE_ROUNDS / ARCHIVE_MERGE_MAX_TURNS / ARCHIVE_MERGE_MAX_BUDGET_USD
- [x] 9.3 spike：symlink 技能发现实证（真实会话内调 Skill 加载 tide-discuss）
- [x] 9.4 全量验证：build → lint → test 通过
- [x] 9.5 文档同步：`docs/2-architecture/overview.md`（新模块）、`docs/2-architecture/data-model.md`（deleted_at + 部分唯一索引）、`docs/3-api/api-reference.md`（无新端点，确认无需改）、`.env.example`（已含）
