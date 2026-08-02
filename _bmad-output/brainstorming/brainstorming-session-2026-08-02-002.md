# Brainstorming Session

- **日期**: 2026-08-02
- **Change**: `project-workspace-isolation`
- **状态**: ✅ 讨论完成

---

## 讨论主题

产品工作流程规范化：为 Oceanus 的每个项目建立**专属物理工作目录**，并让 Claude Agent SDK 的每次运行**固定在当前项目/用户的专属目录下执行**（独立进程 + 权限收紧），实现进程级 + 文件系统级隔离。讨论需求时产出 PRD 文件落盘归档；后续代码生成阶段在独立目录中管理项目代码（v1 仅预留目录）。

现状：项目只有数据库逻辑分区（`partitionKey = projectName/username`），无物理目录；`agent.service.ts` 调用 `query()` 未传 `cwd`（默认 `process.cwd()`，所有会话共享同一根）；system prompt 硬编码项目路径 `/Users/billkang/workspace/oceanus`；PRD 提取后仅存数据库 `assets` 表，不落盘。

## 关键决策

| #   | 决策                                                                                                                | 理由                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 项目物理目录根位置 = **环境变量 `PROJECTS_ROOT` 配置**                                                              | 服务器数据目录可部署态调整，不硬编码到代码/仓库内                                                                                                           |
| 2   | 目录创建时机 = **项目创建时同步建立**（`ProjectService.create`）                                                    | 与项目生命周期绑定，目录随项目存在而存在                                                                                                                    |
| 3   | 目录结构 = `<PROJECTS_ROOT>/<projectName>/`，内含 **`requirements/`（需求工作区）+ `repo/`（代码工作区，v1 预留）** | `requirements` = 讨论需求时的约束根；`repo` = 第二阶段代码生成（git 分支/PR 流程）专用                                                                      |
| 4   | `requirements/` 内区分 **`shared/`（公共）+ `private/`（个人）**                                                    | 公共区存统一/归档 PRD（所有产品角色可见）；个人区按用户×会话隔离产出物                                                                                      |
| 5   | 个人区 = `private/<username>/<sessionId>/`，会话目录用 **SDK 会话 ID** 命名                                         | 每个用户、每次会话专属目录，产出当前会话的产物；SDK 会话 ID 全局唯一无需计数器                                                                              |
| 6   | 隔离级别 = **B：软隔离 + 权限收紧**（`cwd` 固定 + 工具权限白名单），不引入 OS 级硬沙箱                              | 满足隔离诉求的同时部署简单；硬沙箱（容器/chroot）复杂度高，推迟                                                                                             |
| 7   | Agent `cwd` = `private/<username>/<sessionId>/`，`additionalDirectories` 指向 `shared/` 供读取                      | 产出落会话目录，公共 PRD 可读参考；多用户/多会话并行互不冲突                                                                                                |
| 8   | PRD 落盘 = **同时写数据库 `assets` 表 + 落盘**                                                                      | DB 负责索引/检索，磁盘负责实体文件，双份保留                                                                                                                |
| 9   | 归档方式 = **平台侧归档**（后端写三处：会话目录产出 + DB + `shared/prd/<title>.md`），Agent 不写 `shared/`          | 保持 B 隔离不被破坏；后端进程对 `PROJECTS_ROOT` 有完整文件权限，无权限冲突；Agent 驱动归档会弱化隔离且有多会话并发写同名 PRD 风险                           |
| 10  | git 分支/PR 合并流程 = **推迟到代码创建阶段**                                                                       | v1 不做代码生成，git 语义（分支粒度、远程、PR 合并）到 `repo/` 实际启用时再设计                                                                             |
| 11  | PRD 归档方式 = **LLM 语义合并**（OpenSpec 式单向合并），非简单复制                                                  | 平台检测到 PRD 产出后编排一次独立非交互 LLM 调用：读会话 PRD + 读目标聚合文件 → 合并写回；交互式 Agent 不写 `shared/`；并发合并按域文件加锁                 |
| 12  | 总文件结构 = **按功能域拆分** `shared/prd/<域>/<feature>.md`                                                        | 合并范围小、可独立演进；LLM 同时做域归类（复用已有域优先，防"用户管理/用户模块"分裂）                                                                       |
| 13  | skills 安装 = **deepstorm 机制 B**（npm 依赖 + 编程式 API），tide-* **每项目一份**                                  | 版本走 pnpm 管理；项目创建时自动安装到 `<项目>/.claude/skills/`；更新 = bump 依赖 + **惰性刷新**（会话开始前版本比对，落后自动重装）；reef-* 推迟到代码阶段 |
| 14  | 工具权限 = **v1 禁用 Bash**（默认 permissionMode + 白名单）                                                         | 收缩越界写面；保留 Write/Edit/Read/Grep/Glob/Skill/WebSearch/WebFetch                                                                                       |
| 15  | 删除 = **全链路逻辑删除**（5 表 `deleted_at`）+ 物理目录进 `.trash/`                                                | 可恢复、DB/FS 语义对齐；唯一约束改部分唯一索引（`WHERE deleted_at IS NULL`），删过的项目名可重建                                                            |
| 16  | 归档合并触发 = **PRD 产出检测 + 去抖**（3 轮消息无变化触发）                                                        | 及时更新 + 不反复合并；零 UI 改动                                                                                                                           |

## 需求要点

1. **目录结构**（最终确认）：

```
<PROJECTS_ROOT>/                    # 环境变量配置的根目录
└── <projectName>/                  # ① 创建项目时建立
    ├── requirements/               # ② 需求讨论工作区（agent 约束根）
    │   ├── shared/prd/             # ③ 公共区域：统一 PRD、归档（所有产品角色可见）
    │   └── private/<username>/<sessionId>/   # ④ 个人区域（cwd 指向这里，每次会话专属）
    └── repo/                       # ⑤ 代码工作区（第二阶段代码生成，v1 预留）
```

2. **后端**：
   - `PROJECTS_ROOT` 环境变量配置 + 目录路径构建工具（`<root>/<projectName>/requirements/shared/prd/` 等）
   - `ProjectService.create` 时同步创建项目目录骨架
   - `agent.service.ts` 的 `query()` 传入 `cwd = private/<username>/<sessionId>/` + `additionalDirectories = [shared/prd]` + 工具权限白名单收紧
   - 会话目录在首条消息捕获 SDK `session_id`（`system/init`）后懒创建
   - `tryExtractPrd` 改造：PRD 同时写 DB `assets` 表 + 落盘会话目录 + 归档 `shared/prd/<title>.md`
   - 去除 system prompt 中的硬编码项目路径，改为会话目录感知

3. **前端**：v1 无新增 UI（目录在服务端管理）；仅在后端 `assets` 接口或资产面板可能展示落盘路径（待 design 阶段定）

4. **文档同步**：`.env.example`（`PROJECTS_ROOT`）、架构文档（`docs/2-architecture/overview.md`、`data-model.md`）、新增 ADR（项目物理目录与 Agent 隔离）

## 边界范围（不做的）

- ❌ git 分支 / PR 合并流程（推迟到代码创建阶段设计）
- ❌ OS 级硬沙箱 / 容器 / chroot 隔离（B 软隔离为 v1 上限）
- ❌ `repo/` 代码工作区的实际使用（项目代码的物理生成与托管，第二阶段）
- ❌ Agent 自己写入 `shared/` 公共区（归档统一由平台侧执行）
- ❌ 跨项目文件访问的强制访问控制（B 隔离是软约束，`cd ..` 越界靠权限白名单缓解，非物理阻断）
- ❌ 文件生命周期管理（目录清理、配额、压缩归档）
- ❌ 前端目录浏览器 / 文件管理 UI

## 注意事项（约束与风险）

1. **B 隔离是软隔离**：Agent 理论上仍可经 Bash `cd ..` 越界读取/写入项目目录之外 → 需配合工具权限白名单（`canUseTool` / `disallowedTools` / 或限制 Bash 用法），在 design 阶段确定具体收紧策略
2. **`cwd` 改变后 `settingSources: ['project']` 语义变化**：SDK 会从新 `cwd`（会话目录）加载 `.claude/` 配置；现有 tide-discuss skill 依赖 oceanus 仓库的 `.claude/skills`，需确认 Agent 运行时仍能加载到（可能需要把 skill 挂到会话目录或调整 `cwd`/`additionalDirectories` 的组合）
3. **硬编码路径移除**：`agent.service.ts:148` 的 `/Users/billkang/workspace/oceanus` 需改为会话目录感知，不能继续写死
4. **会话目录创建时机**：SDK `session_id` 在首条消息 `system/init` 事件才捕获 → 目录需在该点懒创建，`ProjectService.create` 只建项目级骨架
5. **`additionalDirectories` 读写语义需验证**：SDK 文档表明其授予"额外访问"，但只读/读写行为需实测；如无法只读，需依赖权限白名单限制写 `shared/`
6. **后端权限**：server 进程需要对 `PROJECTS_ROOT` 有完整读写权限（目录由它创建）
7. **并发安全**：同用户多会话并发 → 各自 `private/<username>/<sessionId>/` 互不干扰；但平台归档写 `shared/prd/` 时若同名 PRD 需防冲突（时间戳/覆盖策略）
8. **`configDir`（`os.tmpdir()/oceanus-agent-config/...`）与 `PROJECTS_ROOT` 分离**：本地会话副本继续走临时目录即弃，Postgres 为权威副本——此设计保留，不混入项目目录

## 后续步骤

1. → **阶段三**：SDD 文档生成（proposal → specs → design → tasks），change 名 `project-workspace-isolation`
2. → proposal / specs 各过 grill-me
3. → spec-hardener 审查
4. → writing-plans 实现计划
5. → 实现前门禁 + 风险路由 → TDD 实现
