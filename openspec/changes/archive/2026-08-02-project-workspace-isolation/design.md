# design — 产品工作流程规范化（project-workspace-isolation）

## Context

Oceanus 当前将 Claude Agent SDK 的会话运行环境直接落在仓库内（系统提示词硬编码 `/Users/billkang/workspace/oceanus`），DB 仅有逻辑关系（项目→成员→会话→资产），**没有任何物理目录隔离**。多个项目 / 用户的 Agent 会话共享同一工作区，存在三重问题：

1. **隔离缺失**：Agent 的工具集含 Bash，可越界读写其他项目 / 用户文件；`shared/` 与 `private/` 语义尚未落地。
2. **PRD 无处沉淀**：PRD 自动提取仅写入 `assets` 表，不落盘、不做聚合，用户讨论产出随会话湮没。
3. **删除不可逆**：项目 / 会话删除为物理删除，数据无法恢复。

本 change 建立"**项目 × 用户 × 会话**"的物理目录工作区，将 PRD 经 LLM 语义合并归档到公共区，并对全链路删除改为软删 + 回收站。提案（`proposal.md`）与 8 份 capability spec 已收敛 11 项提案决策 + 6 项 specs 决策（见各 spec 与提案 Known Risks）。

**代码现状（已核实）：**

| 位置                                               | 现状                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `server/src/project/project.service.ts`            | `create()` 单事务建 project + owner member，**无 FS 操作**；`delete()` 物理删除（sessionEntry 清理 + project.delete） |
| `server/src/agent/agent.service.ts`                | `query()` **无 cwd**；提示词硬编码 `/Users/billkang/workspace/oceanus`；工具含 `Bash`；`configDir` 指向临时目录       |
| `server/src/chat/chat.service.ts`                  | 首条消息捕获 `system/init` 懒创建 Session；流结束后 `afterStreamComplete` → 标题更新 + marker 式 PRD 提取             |
| `server/src/asset/asset.service.ts`                | PRD 提取写入 `assets` 表（type: prd）                                                                                 |
| `server/prisma/schema.prisma`                      | 5 表无 `deleted_at`；`Project.projectName @unique`（全量唯一，软删后不可重建同名）                                    |
| `server/src/common/queue/request-queue.service.ts` | 内存并发队列（`MAX_CONCURRENT_LLM`），**非持久重试队列**，单进程模型                                                  |

## Goals / Non-Goals

**Goals:**

- 建立 `<PROJECTS_ROOT>/<projectName>/requirements/{shared,private}/repo` 物理目录骨架；会话目录 `private/<username>/<sessionId>/` 懒创建。
- 交互式 Agent 隔离：`cwd` 锁定会话目录、`additionalDirectories` 指向 `shared/`、工具去 Bash、PreToolUse 写白名单（shared/ 只读）。
- tide-* skills 经 spawn deepstorm CLI 安装到项目工作区，会话目录 symlink 暴露，FS 版本标记惰性刷新。
- PRD 落盘会话目录 + DB `assets` 表，去抖触发独立 LLM 合并归档到 `shared/prd/<域>/<feature>.md`。
- 全链路软删（5 表 `deleted_at` + 部分唯一索引）+ 物理目录进 `.trash/`。

**Non-Goals:**

- 代码托管（`repo/` 目录阶段二才使用）、git 集成、硬沙箱（OS 级进程隔离）、恢复 UI、`.trash/` 清理策略、reef-* 语言相关 skills 安装、shared/ 的 Agent 写权限开放。

## Decisions

### D-1 模块划分：新增 workspace / skills / archive 三模块

| 模块              | 职责                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `WorkspaceModule` | `PROJECTS_ROOT` 配置解析、统一路径构建（防穿越）、骨架创建、会话目录懒创建 + symlink、`.trash/` 回收站 |
| `SkillsModule`    | `SkillsProvider` 接口 + `DeepstormSkillsProvider`（spawn CLI）实现、FS 版本标记读写                    |
| `ArchiveModule`   | PRD 落盘/DB 记录、去抖触发、功能域归并、独立 LLM 合并调用、per-domain mutex、有界重试                  |

改动既有模块：`ProjectService`（FS 先行创建、软删）、`ChatService`（会话目录创建触发、归档触发）、`AgentService`（cwd / additionalDirectories / hooks / 去 Bash）、`SessionService` / `AssetService`（软删查询过滤）。

**备选**：全部塞进 `ProjectService` / 一个巨型 `WorkspaceService` —— 否决。骨架生命周期、skills 供给、归档编排是三个独立关注点，各自有独立测试面；拆模块使接口可单测（尤其 `SkillsProvider` 便于 mock CLI）。

### D-2 PROJECTS_ROOT 配置与统一路径构建

- 新增 `WorkspaceConfig`（构造时经 `ConfigService` 读取 `PROJECTS_ROOT` env，未配置用默认 `./projects` 并 WARN）。`OnModuleInit` 时若根不存在则 `mkdir -p` 自动创建。
- 新增纯函数 `WorkspacePathBuilder`：`sessionDir(projectName, username, sessionId)`、`sharedPrdDir(projectName)`、`trashPath(projectName)` 等；**所有输入先经标识符校验**（拒绝 `..` / `/` / `\` / 空 / 控制字符），违反抛 `PathTraversalError`。
- 约定：**服务内任何文件系统路径只允许经 builder 产出**，禁止手拼字符串；`path.resolve` 后 `startsWith(prefix + path.sep)` 二次断言。

### D-3 创建项目顺序：FS 先行（specs grill-me S2）

`ProjectService.create()` 重构为：

1. **唯一性预校验**：按 `projectName` 查 `deletedAt IS NULL` 记录，已存在直接 409（防 DB 阶段才发现冲突）。
2. **FS 骨架**（幂等）：`WorkspaceService.createSkeleton(projectName)` 建 `requirements/shared/prd/`、`requirements/private/`、`repo/`。失败 → 抛错返回，**DB 无任何副作用**（无需补偿）。**残留目录处理**：若 `<PROJECTS_ROOT>/<projectName>/` 已存在但非本次流程产物（上次软删 rename 失败残留），先 rename 进 `.trash/`，rename 失败则创建失败。
3. **DB 事务**：`$transaction` 建 project + owner ProjectMember。
4. **skills 安装**（best-effort）：`SkillsProvider.install(projectDir)`，失败仅记 error 日志（惰性刷新补装）。

DB 阶段失败属罕见路径（唯一性已预校验），catch 中 best-effort 删除刚建的骨架目录。

**备选**：DB 先行 + 补偿删除 —— 需写补偿逻辑且语义绕；否决。

### D-4 SkillsProvider 接口 + spawn CLI（S1 / S3）

```ts
interface SkillsProvider {
  install(projectDir: string): Promise<void>; // spawn deepstorm setup
  currentVersion(): Promise<string>; // 读 @deepstorm/cli package.json version
  isOutdated(projectDir: string): Promise<boolean>; // 比对标记文件
}
```

- `DeepstormSkillsProvider.install`：`spawn('deepstorm', ['setup', '--non-interactive', '--tools', 'tide'], { cwd: projectDir })`，带超时（`SKILLS_INSTALL_TIMEOUT_MS`，默认 60s）。bin 解析经 `require.resolve('@deepstorm/cli/package.json')` 目录推导，适配 pnpm workspace。
- `currentVersion`：读 `require.resolve('@deepstorm/cli/package.json').version`。
- 版本标记：安装/刷新成功后写项目 `.claude/skills/.deepstorm-skills.json`，内容 `{ installedVersion, installedAt }`。
- 惰性刷新：会话开始 `ensureSessionDir` 时调 `isOutdated`，落后则补装并重写标记。
- **备选**：直接调用 deepstorm 编程式 API —— 已核实 `@deepstorm/cli` 0.13.0 **无 exports/main，纯 Commander CLI**（`packages/cli/src/index.ts` 无库导出），否决；接口隔离保证 deepstorm 将来出 API 时只换实现。

### D-5 会话目录懒创建 + symlink（S6）

`ChatService` 在首条消息处理时调用 `WorkspaceService.ensureSessionDir(projectName, username, sessionId)`，创建顺序见 D-10：

1. `mkdir -p private/<username>/<sessionId>/`
2. 建 `.claude/skills` symlink → 项目根 `.claude/skills`（幂等，已存在跳过）
3. 调 `SkillsProvider.isOutdated`，落后则补装（symlink 自动跟随）

保证 skills 可发现性**从文件系统结构上必然成立**，不依赖 SDK 是否向上回溯（回溯行为未验证）。

### D-10 首条 query 的 cwd 引导（预生成 session_id）

SDK 的 `system/init` 事件在 `query()` **启动之后**才到达，而 `cwd` 在 CLI 进程启动时就必须存在（chdir 目标需真实目录）。解决方案：首条消息**预生成 UUID 作为 `session_id`**，经 `query()` 的 `session_id` 选项注入（SDK 支持指定 UUID 而非自动生成，已核实），据此在 query 启动前创建会话目录，使首条与续传 query 的 `cwd` 均指向会话目录，行为一致。

- 会话目录创建失败 → 中止 query 返回错误；`system/init` 事件返回同一 `session_id`，Session 懒创建逻辑不变。
- 预留风险：query 启动失败时可能残留空会话目录（可回收/后续清理）。spike 确认 TS SDK 的 `session_id` 选项行为。

**备选**：赌 SDK 从嵌套 cwd 向上回溯找项目根 `.claude/`（未验证，失败则 skills 全失效）；每会话复制 skills（多份拷贝难同步）。均否决。

### D-6 写白名单 PreToolUse hook（S4）

`AgentService.sendMessage` 中构建权限 hook（闭包捕获本次 query 的 `sessionDir` / `sharedDir`），与 Langfuse hooks 合并为一个 `hooks` 对象：

- `Write` / `Edit`：目标 resolvedPath 必须以 `sessionDir` 为前缀 → 否则 `deny`（`permissionDecision: 'deny'` + 理由）。
- `Read`：允许 `sessionDir` 与 `sharedDir` 前缀 → 其余 `deny`。
- 配合 **无 Bash** + `cwd` 锁定 + `additionalDirectories`（SDK 文档仅保证"可访问范围扩大"，**不保证只读**，故需显式 hook）构成"准硬"隔离。

**备选**：`disallowedTools` 去掉 Write/Edit（会话目录也无法落盘 PRD，否决）；permissionMode 交互询问（网页无 UI，否决）。

### D-7 独立 LLM 合并调用（S5 + archive-merge spec）

- **触发**：`ChatService.afterStreamComplete` → PRD 提取成功后调 `ArchiveService.onPrdExtracted(sessionId)`；去抖逻辑（内存 Map 记录会话 PRD 内容 hash + 连续无变化轮数，达 `ARCHIVE_DEBOUNCE_ROUNDS`（默认 3，可配置）触发，变化即重置）。
- **域归并**：合并调用前先 `Glob shared/prd/*/`，prompt 中把已有域文件目录列表作为"复用提示"，由模型判断归入已有域或新建。
- **合并执行**：独立 `query()` —— `tools: ['Read','Write','Glob','Grep']`（无 Bash）、**无 sessionStore / resume**、`cwd: 项目 requirements 根`、`maxTurns` 3-5、小预算上限、无交互。
- **幂等重试**：失败指数退避 3 次；仍失败标记 `failed` + 错误日志；PRD 原文始终在会话目录 + `assets` 表（双保险），聚合文件暂落后，同域下次触发自然续上。
- **per-domain mutex**：进程内 `Map<domainPath, Promise<void>>` 链式串行；并发同域合并排队，后到者基于前一轮合并结果继续。
- **备选**：无限重试（队列堆积）；失败降级纯文本 append（污染聚合文件）。均否决。集群模式 mutex 局限见 Risks R4。

### D-8 软删 schema 与迁移（soft-delete spec）

- 5 表各加 `deletedAt DateTime? @map("deleted_at")`。
- **`Project.projectName` 从 `@unique` 移除**，改为：`@@index([projectName], where: "(deleted_at IS NULL)", unique: true, name: "projects_projectName_active")`。
  - **关键核实**：Prisma `@@unique` **不支持 `where`**；部分唯一索引只能用 `@@index` + `where` + `unique: true`（Postgres 渲染 `CREATE UNIQUE INDEX ... WHERE (deleted_at IS NULL)`）。
- 保持不变：`Session.sdkSessionId @unique`（SDK 生成的 UUID 不复用，无软删重建诉求）、`ProjectMember @@unique([projectId, username])`（软删后重建同名成员属罕见边缘，v1 保持，见 Risks R6）。
- **迁移策略**：应用未上线，**不维护迁移文件**——直接修改 `schema.prisma` 后以 `prisma db push` 同步开发库并 `prisma generate` 刷新 client（既有 `init` 迁移保留不动）。
- **查询过滤纪律**：所有读查询统一补 `deletedAt: null`（`list` / `getById` / `assertMember` / session / asset 列表）；删除为 `updateMany set deletedAt` 而非 `delete`。
- **级联软删**：项目删除 → `$transaction` 内按序 `updateMany`：projects → project_members（projectId）→ sessions（projectId）→ session_entries（`partitionKey startsWith "${projectName}/"`）→ assets（projectId 或 sessionId IN）。session_entries 无 FK，靠 partitionKey 前缀匹配。
- **回收站**：DB 软删提交后 `rename` 项目物理目录 → `.trash/<projectName>-<时间戳>/`；FS 失败仅记日志不阻断 DB（可手工恢复）。`.trash/` 首用自动建，重名时间戳保证不覆盖。

### D-9 API Contract（reef-start 要求）

**端点变更：**

| 端点                                        | 变更                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/v1/projects`                     | 创建流程改为 FS 先行（骨架→DB→skills），行为/响应不变（201 + 项目体） |
| `DELETE /api/v1/projects/:projectName`      | 物理删除 → 软删级联 + 目录进 `.trash/`；响应不变 `{ success: true }`  |
| `GET /api/v1/projects` / `GET :projectName` | 读查询过滤 `deleted_at IS NULL`，行为对前端透明                       |
| 会话 / 资产删除（内部 service）             | 改为软删；对前端透明                                                  |

无新增 REST 端点（归档触发为服务内部编排；前端经现有 SSE `AssetReady` 感知）。共享区 PRD 浏览端点是否暴露见 Open Question OQ-2。

**新增环境变量：**

| 变量                           | 默认         | 说明                                   |
| ------------------------------ | ------------ | -------------------------------------- |
| `PROJECTS_ROOT`                | `./projects` | 项目物理目录根                         |
| `SKILLS_INSTALL_TIMEOUT_MS`    | `60000`      | skills 安装超时                        |
| `ARCHIVE_DEBOUNCE_ROUNDS`      | `3`          | 归档合并去抖轮数（PRD 连续无变化轮数） |
| `ARCHIVE_MERGE_MAX_TURNS`      | `5`          | 归档合并 maxTurns 上界                 |
| `ARCHIVE_MERGE_MAX_BUDGET_USD` | `0.2`        | 归档合并预算上界                       |

**Prisma 变更：** 5 表 `deleted_at` 列 + `projects_projectName_active` 部分唯一索引；直接改 `schema.prisma` + `prisma db push`（不生成迁移文件）。

### Change Scope Matrix（reef-start 要求）

| 层            | 改动范围                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------- |
| **DB**        | 5 表 `deleted_at`；`projectName` 唯一索引 → 部分唯一；直接改 schema + `db push`（无迁移文件）  |
| **后端**      | 新增 workspace / skills / archive 三模块；修改 project / agent / chat / session / asset 五模块 |
| **API**       | `POST`/`DELETE` projects 行为变化；无新端点；env 新增 4 项                                     |
| **前端**      | 无结构性改动（软删透明、资产面板由 SSE 驱动）；删除入口已存在                                  |
| **配置/部署** | `PROJECTS_ROOT` 目录挂载；`@deepstorm/cli` 作为 server 依赖；`.env.example` 补充               |

## Risks / Trade-offs

- **R1 软隔离非沙箱**：Agent 仍有 WebSearch/WebFetch 等联网能力，hook 是软件约束而非 OS 级。→ 三重防线（禁 Bash + cwd 锁定 + 写白名单）；真沙箱明确列入 Non-Goals。
- **R2 SDK skill 发现回溯 / symlink 未被识别（未验证）**：若 CLI 既不向上回溯也不跟随 symlink，会话内 skills 失效。→ 会话目录 `.claude/skills` symlink 从结构上保证；design 后首日 spike 实证（冒烟：会话内调 Skill 加载 tide-discuss）。
- **R3 deepstorm `setup` 完整写入面未知**：可能写 `.claude/settings.json`、MCP 配置等，不止 skills。→ spike 确认写入面；若超出仅需范围，改用只复制 `skills/` 子集的实现。
- **R4 集群模式 per-domain mutex 失效**：`CLUSTER_ENABLED=true` 时进程内 Map 无法跨进程串行。→ v1 单进程（与现有 RequestQueue 同假设）；启用集群时改用 Postgres advisory lock 或文件锁。
- **R5 LLM 合并质量不稳定**（丢既有内容 / 格式混乱）。→ 幂等单向覆盖写；prompt 强制"完整保留既有聚合内容"；会话目录 PRD 原文作为权威源可追溯。
- **R6 tombstone 查询纪律**：遗漏 `deletedAt: null` 过滤会泄露已删数据。→ 读查询统一经 service 层封装；code-audit 阶段专项扫描 `findMany`/`findUnique` 的 where 完整性。
- **R7 软删成员复用（projectId, username）重建受限**：软删后 `ProjectMember` 唯一约束仍挡同名重建。→ v1 接受（成员删除场景低频）；如需支持再迁移为部分唯一索引。
- **R8 残留目录数据混杂**：DB 软删与目录 rename 非原子，rename 失败留下残留目录，同名重建可能复用旧数据。→ `createSkeleton` 前置残留目录处理（先移入 `.trash/`，失败则拒绝创建）；见 proposal Known Limitations L1。

## Migration Plan

1. **依赖**：`pnpm add @deepstorm/cli`（server workspace）。
2. **DB**：直接修改 `schema.prisma`（加列 + 重建部分唯一索引）→ `prisma db push` 同步开发库 + `prisma generate`；不生成迁移文件（未上线，不做迁移管理）。
3. **模块合入顺序**：`WorkspaceModule`（路径/骨架）→ `SkillsModule` → `AgentService`（cwd/hooks/去 Bash）→ `ChatService`（会话目录 + 归档触发）→ `ProjectService` 创建/软删 → `ArchiveModule`。
4. **存量项目自愈**：既有项目无物理目录 → 首次进入项目时 `ensureSessionDir` 惰性建目录；skills 无标记 → 视为落后自动安装；无需数据迁移。
5. **回滚**：模块开关可逆（新模块可临时禁用）；DB 通过 `db push` 的 diff 可回退（手动 SQL）；软删数据可从裸表 + `.trash/` 恢复。

## Open Questions

- **OQ-1**：前端删除项目/会话入口确认软删后是否需要任何 UI 调整（如禁用已删项的再次进入）？v1 假设无需改动。
- **OQ-2**：是否暴露共享区 PRD 浏览端点（如 `GET /api/v1/projects/:projectName/shared/prd`）？v1 保守不加，资产面板足够。
- **OQ-3**：spike 已定论（2026-08-02）——`deepstorm setup` 写入面**超范围**（含 `.claude/settings.json`、`.claude/hooks.json` + `hooks/tide-session-preload.sh`、`.claude/agents/`、`.deepstorm/`，hooks 会改变 Agent 行为与写白名单/去 Bash 隔离冲突）→ **改为只复制 `@deepstorm/cli` 内 `dist/skills/tide-*` 模板**到 `projectDir/.claude/skills/`（源含 `SKILL.md.tmpl` 无模板变量，复制后重命名 `SKILL.md`）。CLI bin 已确认 `{ deepstorm: "./dist/cli.js" }` 且无 `exports` 字段。symlink 技能发现实证待 Task 10 收尾。
- **OQ-4**：TS SDK `session_id` 选项行为（覆盖自动生成、`system/init` 返回一致性）——需 spike 实证（Python SDK 已确认支持）。
