---
name: sweep-plan
description: 交互式生成 .flow.md 测试意图文档。从 Issue 或 PRD 提取验收标准，通过结构化对话覆盖功能流程、边界条件、异常场景，输出 Markdown 格式的测试流程。
allowed-tools: Read, Write, Edit, WebFetch, Agent, Bash
deepstorm:
  tool: sweep
mcpCapabilities:
  issue_tracker:
    domain: "project-management"
  knowledge_base:
    domain: "knowledge-base"
---

# Sweep Flow Create — 测试意图文档生成

引导测试工程师从 Issue 或 PRD 出发，通过结构化对话发现测试场景，最终输出 .flow.md 测试意图文档。

## 前置条件

运行 `/sweep-plan` 前，请确保项目已通过 `/sweep-init` 初始化（`.deepstorm/settings.json` 中存在 `sweep.e2eProjectPath` 配置）。

---

## 使用方式

| 方式 | 说明 | 示例 |
|------|------|------|
| **Issue 链接** | 提供 Issue 链接，自动溯源 PRD | `/sweep-plan` 后粘贴 Issue 链接 |
| **PRD 文档链接** | 直接提供 PRD 文档链接 | `/sweep-plan` 后粘贴文档链接 |
| **直接描述** | 没有链接，直接口述功能 | `/sweep-plan` 后选择"描述功能" |

---

## MCP 能力发现（运行时）

本 skill 在运行时通过 `.claude/settings.json` → `deepstorm.mcpCapabilities` 感知可用的 MCP 服务：

| 能力域 | 用途 | 对应 MCP 服务举例 |
|--------|------|------------------|
| `issue_tracker` | 读取 Issue 描述和验收标准 | Jira、Linear 等 |
| `knowledge_base` | 读取 PRD 文档上下文 | 飞书知识库、Confluence 等 |

---

## 工作流

### 步骤 1：检查初始化状态与路径导航

从 `.deepstorm/settings.json` 读取 `sweep.e2eProjectPath`，确定 E2E 测试项目的位置，如非根目录则自动切换。支持从子目录向上查找以兼容用户在 E2E 项目子目录中执行的情况。

#### 1.1 读取配置（支持向上查找）

```bash
# 向上查找 .deepstorm/settings.json
DEEPSTORM_DIR=""
CUR="$PWD"
while [ "$CUR" != "/" ]; do
  if [ -f "$CUR/.deepstorm/settings.json" ]; then
    DEEPSTORM_DIR="$CUR"
    break
  fi
  CUR=$(dirname "$CUR")
done

if [ -n "$DEEPSTORM_DIR" ]; then
  E2E_PATH=$(grep -o '"e2eProjectPath"[^,]*' "$DEEPSTORM_DIR/.deepstorm/settings.json" | head -1 | cut -d'"' -f4)
else
  E2E_PATH=""
fi
```

#### 1.2 配置存在 → 路径导航

- **WHEN** `E2E_PATH` 不为空
- **THEN** 判断路径值。注意 `E2E_PATH` 是基于 `DEEPSTORM_DIR`（settings.json 所在目录）的相对路径，若当前在子目录则需拼接：
  ```bash
  if [ "$E2E_PATH" != "." ]; then
    # 若从子目录找到的 settings.json，E2E_PATH 相对于 DEEPSTORM_DIR
    TARGET_DIR="$E2E_PATH"
    if [ -n "$DEEPSTORM_DIR" ] && [ "$DEEPSTORM_DIR" != "$PWD" ]; then
      TARGET_DIR="$DEEPSTORM_DIR/$E2E_PATH"
    fi
    if [ -d "$TARGET_DIR" ]; then
      echo "📂 切换到 E2E 项目目录: $E2E_PATH"
      cd "$TARGET_DIR"
    else
      echo "❌ E2E 项目目录不存在: $E2E_PATH，请重新运行 /sweep-init"
      exit 1
    fi
  fi
  ```

#### 1.3 配置不存在 → 报错退出

- **WHEN** `E2E_PATH` 为空
- **THEN** 提示"❌ 未检测到 E2E 项目。请先运行 /sweep-init 初始化。"并退出

### 步骤 2：获取测试需求上下文（MCP 动态适配）

本步骤根据 `.claude/settings.json` → `deepstorm.mcpCapabilities` 动态适配测试需求的获取路径。

#### 2.1 询问输入来源

询问用户提供 Issue 链接、PRD 文档链接，或直接描述功能：

> 你想从哪个来源获取测试需求？
>
> 1. **Issue 链接** — 我通过 issue_tracker 读取 Issue 描述，自动溯源关联 PRD
> 2. **PRD 文档链接** — 我通过 knowledge_base 直接读取 PRD 内容
> 3. **直接描述** — 你口头描述功能，不需要链接

根据用户选择进入不同的分支。

---

#### 2.2 通过 Issue 链接获取（issue_tracker 动态检测）

当用户提供 Issue 链接时，AI 根据运行时的能力映射检测可用的 `issue_tracker` 和 `knowledge_base` 服务：

1. **确认能力可用性**：检查 `deepstorm.mcpCapabilities` 中 `issue_tracker.available === true`
2. **选择 provider**：从 `issue_tracker.providers` 中根据 Issue 链接格式自动判断使用哪个（如 jira、linear），判断不出时询问用户
3. **读取工具指南**：读取 `.claude/skills/deepstorm-mcp-jira-read/SKILL.md` 了解工具调用方式
4. **获取 Issue 内容**：使用该 MCP 工具的 get_issue（或等效）方法读取 Issue 描述
5. **提取上下文**：从 Issue 中提取功能范围、用户故事、验收标准
6. **溯源 PRD**：如果 Issue 中包含知识库 PRD 链接，按 2.3 流程处理

**降级处理：** `issue_tracker.available === false` 时，提示用户"未检测到 Issue 跟踪服务，请手动提供需求描述"，继续执行 2.4。

---

#### 2.3 通过知识库获取 PRD（knowledge_base 动态检测）

当用户直接提供 PRD 链接，或 Issue 中包含知识库链接时：

1. **确认能力可用性**：检查 `deepstorm.mcpCapabilities` 中 `knowledge_base.available === true`
2. **选择 provider**：从 `knowledge_base.providers` 中根据链接格式自动判断使用哪个
3. **读取工具指南**：读取 `.claude/skills/deepstorm-mcp-feishu-wiki-read/SKILL.md` 了解工具调用方式
4. **读取文档**：使用可用 knowledge_base MCP 工具的文档读取方法获取 PRD 内容
5. **提取上下文**：提取功能描述、验收标准列表、业务规则和约束条件

**降级处理：** `knowledge_base.available === false` 时，告知用户"未检测到知识库服务"，提示用户手动粘贴 PRD 关键内容。

---

#### 2.4 直接描述（无链接时）

用户口述功能需求（没有链接或所有能力域均不可用时）：
- 记录用户描述的功能名称和概述
- 引导用户提供关键验收标准
- 引导用户提供业务规则和约束

---

#### 2.5 降级处理

当缺少必要能力时，按以下优先级降级：

| 能力缺失 | 降级行为 |
|----------|---------|
| 仅 `issue_tracker` 不可用 | 提示用户手动提供需求描述 |
| 仅 `knowledge_base` 不可用 | 提示用户手动粘贴 PRD 内容 |
| 两者均不可用 | 提示用户直接描述业务场景和测试需求 |

---

### 步骤 3：确定放置位置

#### 3.1 读取 topology.yaml

```bash
cat flows/topology.yaml 2>/dev/null || echo "NOT_FOUND"
```

#### 3.2 AI 推荐位置

基于步骤 2 获取的功能上下文，分析最适合放置的功能模块。

展示给用户：

```
根据功能描述，我推荐放在：
  user-system/login

当前可用模块：
  [1] user-system (用户系统)
      1-1 register (注册)
      1-2 login (登录)
  [2] payment (支付系统)
      2-1 checkout (结算)

推荐位置：user-system/login [1-2]
```

#### 3.3 用户确认或选择

- **确认推荐** → 使用该路径
- **选择其他** → 用户从拓扑中选择其他模块
- **新建模块** → 询问模块名和描述，同步更新 topology.yaml 后使用该路径
- **按 Jira 任务名** → 创建基于任务名的平级目录（如 `LC-1234-user-auth/`）

#### 3.4 确定文件名

- 按功能模块命名：`{module}.flow.md`（适合长期维护）
- 按 Jira 任务命名：`{KEY}-{summary}.flow.md`（适合按迭代组织）

---

### 步骤 4：结构化场景挖掘

基于获取到的需求上下文，按以下四个维度引导用户讨论测试场景。

#### 4.1 功能正常流程

目标：覆盖用户按预期操作的主要成功路径。

引导问题：
- "这个功能最核心的用户操作路径是什么？"
- "用户从开始到完成，需要经历哪些步骤？"
- "有没有多种方式可以完成同一件事？"

AI 根据 PRD 自动梳理出正常流程路径，用户确认或补充。

#### 4.2 边界条件

目标：覆盖输入限制、状态切换、时限条件等边界情况。

AI 根据功能描述自动识别可能的边界，逐项提问：
- "是否涉及输入值的上限/下限？"
- "是否有状态变化的时间窗口限制？"
- "数据量或频率达到极限时表现如何？"

用户确认或补充边界场景。

#### 4.3 异常场景

目标：覆盖用户搞砸了、系统出错、权限不足等路径。

引导问题：
- "如果网络超时会怎样？"
- "如果用户重复提交会怎样？"
- "如果用户没有必要权限会怎样？"
- "如果依赖的系统（第三方、数据库）不可用会怎样？"

#### 4.4 数据组合

目标：覆盖不同数据组合下的行为差异。

引导问题：
- "不同的用户角色在该功能下行为是否不同？"
- "不同的数据类型（如不同国家/语言）是否有不同的行为？"

---

### 步骤 5：Grill-me — 遗漏场景挑战

在初步场景清单确定后，以 grill-me 方式逐项挑战，挖掘遗漏。

使用 Agent 工具运行 grill-me，或直接按以下示例追问：

```
❓ "这个场景有哪些边界情况还没考虑？"
❓ "如果用户不按正常顺序操作会怎样？"
❓ "并发操作会有什么影响？"
❓ "大量数据/长时间使用后行为是否变化？"
❓ "是否有平台差异（不同浏览器/设备）？"
```

每个问题后等待用户回答，根据回答补充或调整场景。

---

### 步骤 6：生成 .flow.md

#### 6.1 组装文件内容

```markdown
# E2E 测试流程：{功能名称}

**来源：** {Issue 链接 / PRD 链接}
**创建时间：** {当前时间}

---

## 场景清单

| ID | 场景 | 类型 | 优先级 |
|----|------|------|--------|
| L01 | {场景标题} | 正常流程 | P0 |
| L02 | {场景标题} | 边界条件 | P1 |
| L03 | {场景标题} | 异常场景 | P1 |

---

## Flow: L01 - {场景标题}

### 前置条件
{前置状态或数据}

### 执行步骤
1. {步骤描述}
   ✅ 验证点：{预期结果}

### 环境要求
- 目标环境：{test/staging/prod}
- 所需账号：{账号类型}

---

## Flow: L02 - {场景标题}
...
```

#### 6.2 写入文件

将内容写入步骤 3 确定的路径：

```bash
flows/{module-path}/{filename}.flow.md
```

#### 6.3 编译 .flow.spec.ts

写入 .flow.md 后，自动调用编译器生成 Playwright `.flow.spec.ts` 测试脚本：

```bash
node scripts/spec-compiler.mjs flows/user-system/login/login.flow.md
```

- 编译器从 step 4 已解析的结构化数据生成 `.flow.spec.ts`
- 生成的 `.flow.spec.ts` 与 `.flow.md` 在同一目录
- 后续 `/sweep-run` 将优先使用 `.flow.spec.ts` 原生执行，获得 ~20x 加速
- 如果页面元素变更导致 `.spec.ts` 跑不过，sweep-run 会自动诊断并修复

#### 6.4 输出确认

```
✅ 测试意图文档已生成：
   flows/user-system/login/login.flow.md
   flows/user-system/login/login.flow.spec.ts  （已编译）

包含 3 个场景、12 个验证点。

下一步：
  /sweep-run flows/user-system/login/login.flow.md  — 立即执行（默认走原生 ~20x 加速）
  或继续 /sweep-plan 创建更多测试流程
```

---

## 检查清单

- [ ] 项目已初始化（读取 settings.json → sweep.e2eProjectPath）
- [ ] 获取到测试需求上下文（Issue / PRD / 描述）
- [ ] 确定放置模块位置（topology.yaml）
- [ ] 确定文件名
- [ ] 结构化场景已收集（正常流程 / 边界条件 / 异常场景）
- [ ] Grill-me 遗漏场景已挑战
- [ ] .flow.md 已生成并写入
