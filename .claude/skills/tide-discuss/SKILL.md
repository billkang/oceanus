---
name: tide-discuss
description: BMAD 多角色需求讨论 → PRD 自动生成 → 知识库推送 → 任务拆分 → Issue 创建。当用户讨论产品需求、新功能、改进建议时自动激活，引导用户通过结构化的 BMAD 工作流（分析师→产品经理→架构师→UX设计师→产品负责人）收敛需求并输出 PRD 文档。
deepstorm:
  tool: tide
mcpCapabilities:
  knowledge_base:
    domain: "knowledge-base"
  issue_tracker:
    domain: "project-management"
---

# Tide — BMAD 需求讨论工作流

Tide 是 DeepStorm 产品侧的 BMAD 工作流，通过结构化讨论引导需求逐步收敛，最终生成 PRD 文档。

所有数据存储在本地文件系统，不依赖外部服务。详细数据格式参考 `references/data-format.md`。

---

## 数据存储约定

**根目录：** `tide-data/`（在当前项目根目录下，而非插件目录），建议将 `tide-data/` 加入项目 `.gitignore` 避免提交运行时数据

| 路径 | 用途 |
|------|------|
| `tide-data/sessions/{sessionId}.json` | 未完成的需求会话（active / prd_ready / published / publish_error） |
| `tide-data/archive/{sessionId}.json` | 已归档的完结会话（completed / superseded） |
| `tide-data/sessions/.sequence` | 会话 ID 序列号 |
| `tide-data/sessions/.index.json` | 会话摘要索引（轻量缓存，入口优先读取） |
| `tide-data/prds/{sessionId}-prd.md` | PRD Markdown 快照 |
| `tide-data/prds/{sessionId}-prd.json` | PRD JSON 快照 |
| `tide-data/abandoned/{sessionId}-prd.md` | 废弃会话的 PRD 文件（原 prds/ → abandoned/） |
| `tide-data/abandoned/{sessionId}-prd.json` | 废弃会话的 PRD JSON 快照 |

**路径规则：** 所有路径相对于用户当前工作目录（`$PWD`）。启动时自动创建 `tide-data/{sessions,archive,prds,abandoned}` 四个子目录。

---

## 工作流程

### 入口：数据扫描 + 输入解析

**触发时机：**
- 用户显式输入 `/tide` 或提及 Tide
- **或** 用户明确表达需求讨论意图（"我想/需要/做一个/讨论一下..."）
> **提示强度：** 随口抱怨（"这个按钮好丑"）或模糊想法 → **不接管**。等用户明确表达再激活

> **讨论中规则：** 已有角色讨论（Step 2）时用户提新需求 → **不自动开新 session**，提示用户选择"结束当前建新"或"先记录继续当前"。用户明确要结束时才走 `/tide` 退出

**数据准备：**
1. **优先加载索引缓存**：读取 `.index.json` 直接获取 session 摘要列表，**文件不存在或解析失败时降级为逐个读取**
2. **自动归档：** 对 `status` 为 `completed` / `superseded` 但文件在 `sessions/` 中的（升级前遗留），**自动移动到 `archive/`**。按 status 判断，与文件名日期无关
3. **异常处理：** JSON 解析失败时跳过该文件，继续加载其他文件，并提示用户损坏文件数
4. **归档目录：** 入口扫描**不读取**归档；参数化查询（sessionId / featureId / 关键词）才**搜索 `sessions/` + `archive/`**
5. **依赖 skill 检查（仅入口一次）：** 检查是否有依赖的外部 skill（不依赖 `deepstorm.installedSkills`）：
   - `bmad` 未安装 → ⚠️ 警告："缺少 bmad 多角色讨论能力，建议 `npx bmad-method install` 安装"（不阻止运行）
   - `grill-me` 未安装 → 💡 提示："安装 grill-me 提升需求追问体验"（不阻止运行）

**决策流程：** 根据用户输入内容判断分支（总览图 → 后续细节见会话流程图和归档流程图）：

```mermaid
flowchart TD
    START(["tide 启动"]) --> SCAN["扫描 tide-data/sessions/<br/>自动归档遗留文件"]
    SCAN --> HAS_INPUT{"有参数？"}
    HAS_INPUT -->|"无"| LIST
    HAS_INPUT -->|"sessionId/featureId/需求描述"| QUERY["查询 sessions/ + archive/"]

    QUERY --> QRES{"查询结果"}
    QRES -->|"有匹配会话"| QSHOW["分组展示匹配的会话<br/>未完结一组 / 已归档一组"]
    QRES -->|"未找到"| S1["Step 1 新建"]

    QSHOW --> QPICK{"用户选择"}
    QPICK -->|"选中未完结会话"| SESS["→ 会话流程图"]
    QPICK -->|"选中已归档会话"| ARCH["→ 归档流程图"]

    LIST["展示未完结列表<br/>active / prd_ready / published / publish_error"]
    LIST --> LRES{"用户选择"}
    LRES -->|"选中一个会话"| SESS
    LRES -->|"新建 / 无数据"| S1

```

> 入口展示逻辑详见下方 `入口操作详情`。

#### 入口操作详情

**无参数（入口列表）：** 扫描 `tide-data/sessions/`，按状态分组展示：

| 状态 | 展示内容 |
|------|---------|
| 🔴 active（讨论中） | Session ID · Feature ID · 简介 · 创建日期 · 已完成角色 · 可选角色 |
| 🟢 prd_ready（PRD 待推送） | Session ID · Feature ID · 简介 · 创建日期 · PRD 路径 |
| 🟢 published（已发布） | Session ID · Feature ID · 简介 · 创建日期 · 知识库链接 · PRD 路径 |
| 🔴 publish_error（发布失败） | Session ID · Feature ID · 简介 · 创建日期 · 失败步骤 · PRD 路径 |

入口列表为空时，**先引导 `/clear`**，再进入 Step 1。进入分析师 Mary 角色，引导用户提出需求，**不要**被动等待。

**有参数查询：** 根据 sessionId / featureId / 中文描述搜索，同时检索 `sessions/` 和 `archive/`。未完结与已归档分组展示。匹配规则：

| 参数类型 | 匹配方式 | 未找到时 |
|---------|---------|---------|
| sessionId | 精确匹配 | 提示不存在，可新建或回到列表 |
| featureId | 精确匹配（多版本按 createdAt 倒序） | 提示无记录，可新建或搜索关键词 |
| 中文描述 | 关键词模糊匹配（brief/summary），top 5 | 直接新建（不提示） |

**各状态可选操作：**

| 会话状态 | 可用操作 | `/clear` 要求 |
|---------|---------|:-:|
| active | 继续讨论 · **变更需求**（→ S1）· 放弃 | 变更需求时先 `/clear` |
| prd_ready | 查看 PRD · 推送 4a · 拆分 4b · **变更需求**（→ S1） | 变更需求时先 `/clear` |
| published | 查看 PRD · 拆分 4b · **变更需求**（→ S1） | 变更需求时先 `/clear` |
| publish_error | 查看 PRD · 重试 · 放弃发布 | — |
| completed（归档） | 查看 PRD · 查看工单 | — |
| superseded（归档） | 查看历史 · 查看后继 · **重来**（→ S1） | 重来时先 `/clear` |

### 会话流程图

选中未完结会话后的完整生命周期（选择操作 → 角色讨论 → 发布 → 归档）：

```mermaid
flowchart TD
    ENTER(["选中未完结会话 → 判断状态"])
    ENTER --> PICK{"会话状态？"}

    PICK -->|"active"| A_GRP["active 操作"]
    A_GRP -->|"继续讨论"| S2_R["Step 2（恢复）<br/>详见「会话恢复」章节"]
    A_GRP -->|"变更需求"| LINK
    A_GRP -->|"放弃"| SUP["superseded → 归档"]

    PICK -->|"prd_ready"| P_GRP["prd_ready 操作<br/>（先 MCP 发现 → 再展示可用操作）"]
    P_GRP -->|"查看 PRD"| VIEW
    P_GRP -->|"知识库可用时推送到知识库（4a）"| PA["Step 4a<br/>知识库推送"]
    P_GRP -->|"工单系统可用时拆分为任务（4b）"| PB
    P_GRP -->|"变更需求"| LINK

    PICK -->|"published"| U_GRP["published 操作<br/>（工单系统可用时展示 4b）"]
    U_GRP -->|"查看 PRD"| VIEW
    U_GRP -->|"工单系统可用时拆分为任务（4b）"| PB["Step 4b<br/>任务拆分"]
    U_GRP -->|"变更需求"| LINK

    PICK -->|"publish_error"| E_GRP["publish_error 操作<br/>（按失败步骤和服务可用性）"]
    E_GRP -->|"查看 PRD"| VIEW
    E_GRP -->|"对应服务可用时重试发布"| ERR
    E_GRP -->|"放弃发布"| SUP

    SUP -->|"重来"| LINK
    LINK["旧会话 → superseded<br/>新 parent → 旧 sessionId<br/>旧 supersededBy → 新 sessionId<br/>旧文件移入 archive/<br/>→ 必须先引导 /clear"] --> S1
    S1["Step 1 新建<br/>→ 先 /clear → 再澄清需求"] --> S2_N["Step 2（新建）"]

    S2_R -->|"必需角色完成"| OPT_REQ{"可选角色处理"}
    S2_N -->|"必需角色完成"| OPT_REQ
    OPT_REQ -->|"无待处理 / 用户跳过"| S3
    OPT_REQ -->|"用户继续"| OPT_DISC["讨论可选角色"]
    OPT_DISC -->|"完成后"| OPT_REQ

    S3["Step 3 生成 PRD<br/>status → prd_ready"] --> MC["🔍 MCP 能力发现<br/>（检测可用的知识库和工单服务）"]
    MC --> S3_OPT{"根据 MCP 结果展示可用操作"}
    S3_OPT -->|"知识库可用 → 推送（4a）"| PA
    S3_OPT -->|"工单系统可用 → 任务拆分（4b）"| PB["Step 4b<br/>任务拆分"]
    S3_OPT -->|"查看 PRD"| VIEW
    S3_OPT -->|"无可用服务时全部跳过 → 归档"| DONE
    S3_OPT -->|"稍后再处理"| EXIT["回到 Tide 入口<br/>会话可在列表继续操作"]
    VIEW["查看 PRD 文档"] -->|"返回操作选择"| ENTER

    PA -->|"成功"| PUB["status → published"]
    PA -->|"跳过（无知识库服务）"| PA_SKIP{"工单系统可用？"}
    PA_SKIP -->|"是 → 进入 published"| PUB
    PA_SKIP -->|"否 → 全部跳过"| DONE
    PA -->|"失败"| ERR["status → publish_error"]

    PUB --> KB_CHECK{"工单系统可用？"}
    KB_CHECK -->|"是 → 拆分为任务（4b）"| PB["Step 4b<br/>任务拆分"]
    KB_CHECK -->|"否 → 全部跳过"| DONE
    PB -->|"用户确认"| PC["Step 4c<br/>创建工单"]
    PC -->|"全部成功"| DONE(["✅ 完成 → 归档"])
    PC -->|"部分失败"| ERR

    ERR --> RETRY_CHK{"检查失败步骤<br/>和对应服务可用性"}
    RETRY_CHK -->|"4a 失败且知识库仍可用"| PA
    RETRY_CHK -->|"4c 失败且工单系统仍可用"| PC
    RETRY_CHK -->|"对应服务不可用 → 放弃"| SUP
    RETRY_CHK -->|"放弃发布"| SUP

```

---

### Step 1: 初始化会话

用户从入口选择了「新建」「重来」，或通过 LINK 进入新会话后：

**上下文隔离（完成后再继续 Step 1）：**

1. **AI 声明切换** — 以明确语句宣告上下文切换（如"好的，现在开始全新的需求讨论"），**禁止引用旧内容**
2. **引导 `/clear`** — 在声明后提示用户清空终端，等待用户回复后再继续

**上下文隔离完成后的 Step 1：**

1. 如果入口已传入上下文（如 featureId、brief 预填值），直接用；**否则向用户澄清需求后，AI 提炼为一段不超过 50 字的中文概要存入 `brief`**
2. 读取 `tide-data/sessions/.sequence` 计算新的 sessionId，**计算后将新序列号写回 `.sequence` 文件**
3. 根据需求描述生成 featureId（格式参考 `references/data-format.md`）
   - 如果 AI 提供了 featureId 备选方案，且用户选了与 brief 不一致的方案，**提示用户是否要更新 brief 描述**
4. 如果入口关联了旧会话（parent），在新会话 JSON 中设置 `parent` 字段
5. 创建 session JSON 文件，`status: "active"`
6. 告知用户 sessionId 和 featureId
7. **写入索引缓存**：在 `tide-data/sessions/.index.json` 中追加新 session 的摘要条目（sessionId、status、brief、createdAt、featureId）。文件不存在时自动创建

进入第 1 个角色（💼 业务分析师 Mary），角色引导 prompt 见 `references/role-prompts.md`。analyst 入场时先**简要复述 `brief`**，在已确认的 brief 基础上深入讨论，**不要重复问"你想做什么需求"**。

---

### Step 2: 角色讨论流程

Step 2 有两种入口：
- **S2_NEW（新建）** — 从 Step 1 进入，从第一个角色（analyst）**从头开始**
- **S2_RESUME（恢复）** — 从入口选中 active 会话进入，**跳过已完成的角色**，从第一个未完成角色继续

两种入口共享同一套讨论流程（见会话流程图 Step 2 分支 → OPT_REQ → OPT_DISC → S3）。

**规则：**
- 一次只扮演一个角色
- 一次只问一个问题
- 引导用户自己决策，不替用户做决定
- 讨论语言跟随用户

**Checklist 约束（重要）：**

每个角色有固定的讨论 checklist（`references/checklists.md`），用于防止跳过重要环节。

1. **进入角色时** — 立即展示全部 checklist 项（均标记 ⬜），参考格式：
   > **原则：** 展示 checklist 为**目录预览**，让用户了解讨论范围。展示后**只追问第一项未完成项**，不同时问所有项。
   ```
   📋 分析师 Mary — 讨论进度
   ⬜ 需求背景和业务目标
   ⬜ 目标用户画像
   ⬜ 核心痛点分析
   ⬜ 竞品调研
   ⬜ 关键成功指标
   ```

2. **每轮讨论后** — 评估用户回答覆盖了哪些项，更新 checklist 状态（⬜ → ☑️），展示最新进度

3. **完成判定：**
   - **必需角色（analyst、pm）：** 全部 ☑️ 后才能进入 Step 3 生成 PRD，这是**硬性门禁**
   - **可选角色（architect、designer、po）：** 如果用户同意跳过，则添加 `skipped: true` 占位记录，**不阻塞 PRD 生成**；如果开始讨论，则需要全部 ☑️ 才算完成

5. **用户说"差不多"时** — 检查 checklist 中是否有未勾选项，若有则追问（"关于 {未完成项} 还需要了解一下"）

**Checklist 持久化—三步走（重要）：**

```
进入角色时
  ↓
① 创建骨架 — 在 session JSON 的 steps[] 中追加一条新记录：
   {role: "analyst", skipped: false, completedAt: null, checklist: [{item: "需求背景", done: false}, ...]}
   写入文件（此时该角色无 summary / decisions / requirements，仅骨架）
  ↓
每轮讨论后
  ↓
② 更新条目 — 仅修改 checklist 中对应项的 done 值（false→true）
   写入文件（summary / decisions / requirements 同步累加）
  ↓
角色完成时
  ↓
③ 完成填写 — 补全 summary、decisions、requirements，设置 completedAt
   写入文件
```

这样对话在任意时刻中断，恢复时：
- 看到 `checklist` 中哪些 done=true → 从未完成的项开始问
- 看到 `completedAt: null` → 知道角色未完成
- 看到 `skipped: true` → 跳过该角色

---

### Step 3: 生成 PRD

**触发时机：** 所有必需角色（analyst + pm）讨论完成后的自动步骤。

1. 按以下模板生成 PRD Markdown，保存到 `tide-data/prds/{sessionId}-prd.md`
2. 保存 JSON 快照到 `tide-data/prds/{sessionId}-prd.json`
3. 更新 session JSON 的 `status` 为 `prd_ready`，并同步更新 `.index.json` 中对应条目的 status
4. **必须先执行 MCP 能力发现**（见下方 Step 4 入口前置检查），根据能力映射结果**只展示可用的操作选项**：
   - 始终提供"查看 PRD"和"稍后再处理"
   - `knowledge_base.available = true` → 展示"推送到知识库（4a）"
   - `issue_tracker.available = true` → 展示"拆分为任务（4b）"
   - **全部不可用时** → 自动全部跳过（4a+4b+4c 标记 skipped），`status` → `completed`，告知用户后自动归档

PRD 模板见 `references/prd-template.md`（Step 3 生成时按模板填充）。

**异常处理（PRD 文件丢失）：** 后续 4a 推送到知识库时如果发现 PRD Markdown 文件不存在（被误删），按以下顺序恢复：
1. 优先从 `tide-data/prds/{sessionId}-prd.json` 快照重新生成 Markdown（JSON 内容与模板对应）
2. 如 JSON 快照也不存在，从 session JSON 的 `steps[]` 记录（summary / decisions / requirements）重新生成 PRD Markdown
3. 重新写入 `tide-data/prds/{sessionId}-prd.md`，告知用户文件已恢复

---

### Step 4: 发布 — MCP 感知的动态流程

PRD 生成后（`status: prd_ready`），分三步完成发布流程，每步根据已安装 MCP 服务动态决定是否执行或跳过。

#### MCP 能力发现（⚠️ 前置检查 — Step 3 + Step 4 共用）

**此检查在 Step 3 生成 PRD 后、向用户展示操作选项之前就必须执行！** 不能等到进入 Step 4 才做。

AI **必须首先完成 MCP 能力发现**：

1. 读取 `.claude/settings.json` → `deepstorm.mcpCapabilities`，了解本 skill 需要哪些能力域以及每个域的可用 provider
2. **检查缓存**：若当前 session JSON 中存在 `services.capabilities`，跳过重新发现，直接使用缓存值
3. **首次发现**（无缓存时）：按能力映射结果决定 4a/4b/4c 各步的执行策略，将结果写入 `services.capabilities`
4. **用户要求重试时**：忽略缓存，重新发现并更新 `services.capabilities`

**可用性判定：**
- `knowledge_base.available = true` → 4a 可执行，否则跳过
- `issue_tracker.available = true` → 4b 可执行、4c 可创建工单，否则跳过 4b+4c
- providers 数组长度 > 1 → 在该步骤入口询问用户选择哪个 provider

#### 4a 知识库推送

将 PRD Markdown 推送到知识库。按能力映射可用性和 provider 数量动态执行：

| 场景 | 行为 |
|------|------|
| `knowledge_base.available = true`，1 个 provider | **自动推送**：读取 `.claude/skills/deepstorm-mcp-feishu-wiki-write/SKILL.md` 了解工具调用方式，使用该 MCP 推送 PRD，无需用户选择 |
| `knowledge_base.available = true`，≥ 2 个 provider | **用户选择**：展示可用列表，用户选择后按对应 MCP skill 执行推送，选择结果持久化到 `services.knowledgeBase.provider` |
| `knowledge_base.available = false` | **跳过**：`publishChecklist[0]` 记录 `{step:"knowledge_base_push", done:true, skipped:true, note:"无可用知识库服务"}`，告知用户"未检测到知识库服务，跳过 PRD 推送"，直接进入 published |

**前置检查（4a 开始前）：**
1. 检查 `tide-data/prds/{sessionId}-prd.md` 是否存在；不存在则按优先级恢复（JSON 快照 → steps 重建）
2. PRD 文件存在后，按上述策略执行推送

**成功后：** 保存 `services.knowledgeBase`（含 provider 和 url），`publishChecklist[0]` 记录 `{step:"knowledge_base_push", done:true}`，`status` 改为 `published`，同步更新 `.index.json` 对应条目的 status

**失败后：** `publishChecklist[0]` 记录 `{step:"knowledge_base_push", done:false, note:"错误信息"}`，`status` 改为 `publish_error`，同步更新 `.index.json` 对应条目的 status，提示用户重试或放弃

#### 4b 任务拆分

将 PRD 拆解为候选任务清单，由用户确认。本步骤不依赖 MCP 调用，仅受是否有可用工单系统影响：

| 场景 | 行为 |
|------|------|
| `issue_tracker.available = true` | **正常拆分**：将 PRD 拆解为 Epic + Story 层级，展示给用户确认。确认后写入 `services.issueTracker.taskBreakdown` |
| `issue_tracker.available = true`，≥ 2 个 provider | **额外步骤 — 选择工单系统**：在 4b 入口询问"检测到多个工单系统，本次使用哪个？"，选择结果持久化到 `services.issueTracker.provider`，恢复时不重复询问 |
| `issue_tracker.available = false` | **跳过 4b + 4c**：`publishChecklist[1]` 记录 `{step:"issue_task_split", done:true, skipped:true, note:"无可用工单系统"}`，`publishChecklist[2]` 记录 `{step:"create_issues", done:true, skipped:true}`，`status` 直接改为 `completed`，告知用户"未检测到工单系统，跳过任务拆分和 Issue 创建"，自动归档（归档时从 `.index.json` 移除条目） |

**用户中止：** 如果用户说"先这样"，保持 `published` 状态，`publishChecklist[1].done = false`，提示可随时继续

#### 4c 创建工单

按 4b 确认的任务清单和所选 provider 创建工单：

| 场景 | 行为 |
|------|------|
| 唯一 provider | **自动创建**：读取 `.claude/skills/deepstorm-mcp-jira-write/SKILL.md` 了解工具调用方式，逐条创建 |
| 用户已选择 | 使用 `services.issueTracker.provider` 记录的 provider，恢复时不重复询问 |
| 多 provider 且未选 | 在 4c 入口询问用户选择，结果持久化到 `services.issueTracker.provider` |

**失败处理：**
- **全部成功**：保存 `services.issueTracker.urls`（自动去重），`publishChecklist[2]` 记录 `{step:"create_issues", done:true, total:N, created:N}`，移除 `failedItems`，`status` 改为 `completed`，自动归档（归档时从 `.index.json` 移除条目）
- **部分失败**：成功 URL 加入 `services.issueTracker.urls`，`publishChecklist[2]` 记录 `failedItems`，`status` 改为 `publish_error`，同步更新 `.index.json` 对应条目的 status，下次恢复时从 `services.issueTracker.taskBreakdown`（降级 `jiraTaskBreakdown`）重建上下文，仅重试失败项
- **全部失败**：`publishChecklist[2]` 记录全部条目为 `failedItems`，`status` 改为 `publish_error`，同步更新 `.index.json` 对应条目的 status，提示用户检查 MCP 连接

**恢复路径：** 恢复 `published` 或 `publish_error` 状态的 session 时，AI 检查 `publishChecklist` 中的 `skipped` 标记，跳过已被跳过的步骤。已完成的步骤不重复执行。

> **完整发布流程参考** `references/publish-flow.md`，含错误处理、恢复路径、MCP 动态适配。

---

### 流程结束后的行为

以下节点表示一个会话的工作流结束，AI 应回到正常对话（非 Tide 模式）：

| 结束节点 | 触发条件 | AI 行为 |
|---------|---------|--------|
| DONE（✅ 归档） | 4c 全部成功或 MCP 全部跳过 | 告知完成，**如需新建先 `/clear` 再进入 Step 1** |
| SUP（superseded） | 用户选择「放弃/放弃发布」 | 告知已归档，**如需新建先 `/clear` 再进入 Step 1** |
| EXIT | 用户选择「稍后再处理」 | 展示待处理列表 |
| 新建取消 | 列表为空，用户说"先不做了" | 回到正常对话模式 |

> **S1 行为：** 引导澄清需求，用户中途放弃则回到正常对话，不强制完成。

### 归档

**归档时机：**

| 时机 | 状态 |
|------|------|
| 4c 全部成功或 MCP 全部跳过 | `completed` → 立即归档 |
| 用户选择「放弃/变更需求/重来」 | `superseded` → 立即归档 |
| 每次入口扫描 | 自动搬移残留文件 |

**归档操作：**
1. `sessions/{sessionId}.json` → `archive/`
2. 从 `.index.json` 移除条目
3. `superseded` 时：检查 `prds/{sessionId}-prd.*` 存在则移入 `abandoned/`（completed 不移）
4. 归档会话不出现在入口列表，可通过 sessionId/featureId 精确查询

**重来时：** 新 `parent` = 旧 sessionId，旧 `supersededBy` = 新 sessionId，**先引导 `/clear`**。

---

### 会话恢复

用户从入口选择「继续/恢复」后：

1. **查找文件：** 先 `sessions/`，再 `archive/`
2. 根据 `status` 决定恢复行为：

   | status | 恢复路径 |
   |--------|---------|
   | `active` | 找到第一个未完成角色（先 `skipped`，再 `completedAt`），从该角色继续 |
   | `prd_ready` | MCP 发现后按可用服务进入对应步骤 |
   | `published` | 按 `publishChecklist`：4a 跳过不重试；4b 未完成则继续；4c 部分失败重试 |
   | `publish_error` | 重试失败步骤，或放弃发布 |
   | `completed` | 只读展示 PRD + 工单链接 |
   | `superseded` | 只读展示，可查看替代或重来 |

3. 角色全部完成但 status 仍为 `active` → 进入 Step 3

**恢复时：** `skipped: true` 步骤直接跳过；checklist 优先从 `steps[].checklist` 读取，为空则从 decisions/requirements 推断，仅展示未完成项。

### 讨论中收到 `/tide`

1. **保存进度** — checklist 已持久化
2. **退出角色** — 回到入口列表
3. 用户可选「继续讨论」或选择其他会话

### 会话关联

用户选择「变更需求/重来」后：

1. 读取旧会话 JSON 作为参考上下文
2. 新 `parent` = 旧 sessionId，旧 `supersededBy` = 新 sessionId，旧 status → `superseded`
3. **上下文隔离：** AI 必须先宣告切换并引导 `/clear`，禁止引用旧内容

---

**参考文件索引：** `data-format.md`（数据格式）· `role-prompts.md`（角色 prompt）· `checklists.md`（checklist）· `prd-template.md`（PRD 模板）· `publish-flow.md`（发布流程） |

---

## 关键约束

1. **不要跳过必需角色** — analyst 和 pm 必须完成
2. **Feature ID 规则：**
   - 不要超过 **5 个英文单词**（`AUTH-LOGIN-WECOM` 计为 3 个，`PAYMENT-ORDER-REFUND-V2` 计为 4 个）
   - AI 拿不准时，提供 **2-3 个备选方案**让用户选择，不要自己做主
