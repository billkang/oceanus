# Proposal: 项目专属物理工作目录与 Agent 运行隔离

> 需求来源：2026-08-02 brainstorming 讨论（`_bmad-output/brainstorming/brainstorming-session-2026-08-02-002.md`）
> 目标：产品工作流程规范化 —— 项目创建时建立专属物理目录，Claude Agent SDK 每次运行固定在当前项目/用户的专属目录下（独立进程 + 权限收紧），PRD 产出由平台编排 LLM 语义合并归档到公共区域。

## Why

Oceanus 目前项目与用户只有**数据库逻辑分区**（`partitionKey = projectName/username`），没有对应的物理工作目录。Agent SDK 调用未传 `cwd`，所有会话默认共享 `process.cwd()`（server 进程的工作目录）；PRD 提取后仅存数据库 `assets` 表，无实体文件；tide-discuss skill 依赖 oceanus 仓库 `.claude/skills`，与项目工作区解耦。这导致：Agent 的工作根目录不受控、多用户/多会话的文件操作相互混杂、PRD 没有可检索的物理归档、skills 与项目没有绑定。

需要为每个项目建立**专属物理工作目录**（`PROJECTS_ROOT/<projectName>/`），并让 Agent 每次运行 `cwd` 固定到该项目的用户会话子目录，实现进程级 + 文件系统级的隔离；PRD 产出由平台编排 LLM 语义合并归档到公共区域，供产品角色统一查看。

## What Changes

- **新增物理目录体系**：`PROJECTS_ROOT`（环境变量配置）下按项目建立目录骨架：`<projectName>/requirements/`（需求工作区）+ `<projectName>/repo/`（代码工作区，v1 仅预留目录）。
- **需求工作区双层隔离**：`requirements/shared/prd/<功能域>/<feature>.md`（公共区域：按功能域拆分的统一 PRD，所有产品角色可见）+ `requirements/private/<username>/<sessionId>/`（个人区域：每次会话专属，Agent 工作根目录）。
- **skills 程序化安装（deepstorm 机制 B）**：server 引入 `deepstorm` npm 依赖；项目创建时用其编程式 API 安装 tide-* skills 到 `<projectName>/.claude/skills/`；版本更新走 npm bump + 会话开始前惰性刷新（版本标记比对，落后自动重装）。reef-* 推迟到代码阶段。
- **Agent 运行隔离（级别 B）**：`query()` 传入 `cwd = private/<username>/<sessionId>/`，`additionalDirectories = [shared/prd]` 供只读参考，工具白名单收紧（**禁用 Bash**，保留 Write/Edit/Read/Grep/Glob/Skill/WebSearch/WebFetch）。
- **会话目录懒创建**：首条消息捕获 SDK `session_id`（`system/init`）后创建会话专属目录。
- **PRD 落盘 + LLM 语义合并归档**：`tryExtractPrd` 改造 —— PRD 落会话目录产出物 + 写 DB `assets` 表；平台检测到 PRD 产出（去抖窗口）后，编排一次独立非交互 LLM 合并调用：读会话 PRD + 读目标功能域聚合文件 → 语义合并 → 写回 `shared/prd/<域>/<feature>.md`。交互式 Agent 不写公共区。
- **全链路逻辑删除 + 回收站**：`deleted_at` 软删（5 表：projects/sessions/project_members/session_entries/assets，所有读查询过滤）；删除事务级联置 deleted_at + 物理目录 `rename` 进 `<PROJECTS_ROOT>/.trash/`。
- **去除硬编码路径**：system prompt 中的 `/Users/billkang/workspace/oceanus` 改为会话目录感知。
- **schema 迁移**：新增 `deleted_at` 列（5 表）+ project name 等唯一约束改部分唯一索引（`WHERE deleted_at IS NULL`）。

## Capabilities

### New Capabilities

- `project-workspace`: 项目物理目录生命周期管理 —— `PROJECTS_ROOT` 配置、目录骨架创建、路径构建、会话/公共目录创建、回收站（`.trash/` rename）。
- `agent-workspace-isolation`: Agent 运行目录隔离 —— `query()` 的 `cwd`/`additionalDirectories`、工具白名单（禁 Bash）、会话目录懒创建时点。
- `skills-provisioning`: 项目 skills 程序化安装与更新 —— deepstorm 机制 B、tide-* 每项目安装、版本惰性刷新。
- `archive-merge`: PRD 语义合并归档 —— PRD 产出检测 + 去抖、功能域归并、独立 LLM 合并调用、域文件并发锁。
- `soft-delete`: 全链路逻辑删除 —— `deleted_at` 软删（5 表）、查询过滤纪律、删除事务级联 + 回收站。

### Modified Capabilities

- `project-management`: 项目创建 SHALL 同步建立物理目录骨架并安装 skills；删除 SHALL 走软删 + 回收站（新增行为）。
- `agent-integration`: SDK 初始化 SHALL 传入 `cwd`（会话目录）与 `additionalDirectories`（公共 PRD 区），收紧工具权限（禁 Bash），system prompt 路径感知（新增行为）。
- `asset-panel`: PRD 自动提取 SHALL 落盘会话目录并触发 LLM 合并归档，不再仅存数据库（行为变更）。

## Impact

- **后端代码**：
  - `server/src/project/project.service.ts` — create 建目录骨架 + 安装 skills；delete 软删级联 + 目录进回收站
  - `server/src/agent/agent.service.ts` — `query()` 增加 `cwd`/`additionalDirectories`/权限白名单（禁 Bash）；system prompt 路径感知
  - `server/src/chat/chat.service.ts` — 首条消息后创建会话目录；PRD 产出检测（去抖）+ 触发合并
  - 新增 workspace 模块（路径构建/文件操作/回收站）
  - 新增 skills-provider 模块（deepstorm 集成：安装/版本比对/惰性刷新）
  - 新增 archive-merge 服务（LLM 合并编排：域归并 + 并发锁）
  - 各服务读查询统一过滤 `deleted_at IS NULL`
- **数据模型**：Prisma schema 5 表加 `deleted_at`；唯一约束改部分唯一索引（migration）
- **依赖**：server `package.json` 引入 `deepstorm`
- **环境变量**：`.env.example` 新增 `PROJECTS_ROOT`
- **文档同步**：新增 ADR（项目物理目录与 Agent 隔离 + 逻辑删除与归档合并）；更新 overview.md、data-model.md、api-reference.md、.env.example
- **不影响**：前端 UI（v1 无新增界面）、模型注册、会话分区、请求队列

## Out of Scope

1. ❌ git 分支 / PR 合并流程（推迟到代码创建阶段设计）
2. ❌ `repo/` 代码工作区的实际使用（项目代码生成与托管，第二阶段）
3. ❌ OS 级硬沙箱 / 容器 / chroot 隔离（B 软隔离为 v1 上限）
4. ❌ Agent 自身写入 `shared/` 公共区（归档统一由平台侧执行）
5. ❌ 跨项目文件访问的强制访问控制（B 隔离为软约束，靠权限白名单缓解）
6. ❌ 文件生命周期管理（回收站清理策略、配额、压缩归档）—— v1 回收站只进不出
7. ❌ 恢复功能 / 前端目录浏览器 / 文件管理 UI
8. ❌ reef-* skills 安装（语言相关，代码阶段引入）
9. ❌ 模型注册、会话分区、请求队列等既有能力的重构

## Acceptance Criteria

1. 创建项目后，`PROJECTS_ROOT/<projectName>/requirements/shared/prd/`、`requirements/private/`、`repo/` 目录自动存在，且 `<projectName>/.claude/skills/` 已安装 tide-* skills。
2. 首次会话开始后，`private/<username>/<sessionId>/` 会话目录自动创建（`sessionId` = SDK 会话 ID）。
3. Agent 运行时工作根目录为该会话目录（`cwd`），能读取 `shared/prd/` 公共 PRD，不能在会话目录之外写入（Bash 已禁用）。
4. 讨论产出 PRD 后：DB `assets` 表新增记录、会话目录保留产出物、去抖窗口后 `shared/prd/<域>/<feature>.md` 由 LLM 合并归档存在。
5. 两个用户/两个会话并行运行时文件操作互不冲突；同一域文件并发合并串行化。
6. system prompt 不再包含硬编码的 `/Users/billkang/workspace/oceanus` 路径。
7. 删除项目/会话：DB 记录软删（`deleted_at` 置位，读查询不可见），物理目录移入 `.trash/`，均可从裸表/回收站恢复。
8. deepstorm 发版后，新项目装新版 skills；已有项目会话开始前惰性刷新。

## Known Risks

1. **隔离为软件约束非硬沙箱**：即便禁用 Bash + 写白名单 hook，Agent 仍保有联网等能力 → 三重防线为缓解手段；OS 级硬沙箱明确推迟。
2. **symlink 技能发现待 spike 实证**：会话目录 `.claude/skills` symlink 指向项目根 skills，需实证 SDK/CLI 能跟随 symlink 发现技能（结构性兜底，即便不回溯也可用）。
3. **deepstorm CLI 写入面待确认**：spawn `deepstorm setup` 可能写 settings.json/MCP 等非 skills 内容 → spike 确认；若超范围改为只复制 `skills/` 子集。
4. **归档合并并发**：同一域文件可能被多个会话同时合并 → per-domain mutex 串行化；合并失败有界重试（幂等）。
5. **tombstone 查询纪律**：全链路软删要求所有读查询过滤 `deleted_at IS NULL`，漏一处即幽灵数据外泄 → 查询清单化 + 测试覆盖。
6. **LLM 合并质量**：域归并与语义合并依赖模型判断，同名/近义域可能漂移 → 合并提示词约束"复用已有域优先"；失败走有界重试 + 标记 failed，PRD 原文双保险不丢（不做纯文本追加降级）。
7. **deepstorm CLI 稳定性**：spawn 外部 CLI 依赖其命令面稳定；失败路径有超时 + best-effort 不阻断。
8. **残留目录复用**：软删同名重建时旧物理目录若未能进 `.trash/`，新项目可能复用旧目录 → 骨架创建前强制处理残留目录（见 Known Limitations L1）。

## Known Limitations

- **L1 残留目录可能导致数据混杂**：删除时 DB 软删与目录 rename 非原子（rename 失败仅记日志）。同名 projectName 重建时，若残留目录仍存在于项目根，`createSkeleton` 必须先将其移入 `.trash/`（或拒绝创建），避免新旧数据混杂。
- **L2 归档合并可能长期滞后**：去抖窗口内 PRD 持续变化会重置计时，长会话可能长时间不归档；共享区最终一致但非实时。轮数可配置（`ARCHIVE_DEBOUNCE_ROUNDS`）。
- **L3 合并无版本历史**：`shared/prd/<域>/<feature>.md` 为单向覆盖写，模型改写/丢失内容时无历史可回滚；权威源为会话目录 PRD 原文与 `assets` 表。版本管理推迟 v2。
- **L4 回收站只进不出**：`.trash/` 清理策略（配额、TTL）推迟；v1 依赖人工清理，磁盘增长不受控。

## Validation

1. 单元测试：`WorkspacePathBuilderTest`（合法/非法标识符防穿越）、`WorkspaceServiceTest`（骨架幂等、会话目录 + symlink、trash 重名不覆盖、**残留目录处理**）、`SkillsProviderTest`（install mock / currentVersion / 标记读写 / 失败路径）、`ArchiveServiceTest`（去抖、幂等重试、mutex 串行、失败标记）、各 service tombstone 查询过滤单测（断言 `deletedAt: null`）。
2. 集成测试：创建项目 → 目录 + skills 存在；会话开始 → 会话目录创建；PRD 产出 → 三处落盘 + LLM 合并归档；删除 → 软删 + 回收站。
3. 手动验证：两个用户并行讨论互不冲突；Agent 写 `shared/` 被 hook 拒绝；会话内调 Skill 加载 tide-discuss（symlink spike）。
4. 回归：既有 PRD 资产面板、会话分区、模型切换不回归。
5. 命令门禁：`pnpm --filter server build && lint && test` 全绿后方可合入。
