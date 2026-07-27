---
name: reef-gen-frontend
description: 前端代码编写流程（Angular 21 + TypeScript + Signal + PrimeNG + Tailwind CSS 4）。编写或生成前端代码时自动加载，编码规范详情引用 reef:reef-style-frontend。
when_to_use: 用户要求编写或修改前端代码；创建新的前端文件；用户说"生成前端代码""写页面""写组件""加表单"等
user-invocable: false
allowed-tools: Bash(git:*), Bash(pnpm:*)
model: opus
deepstorm:
  tool: reef
  configKey: reef.frontend.framework
---

# 前端代码编写流程

编码规范详情（组件/Signal/Signal Forms/HTTP/UI 库/CSS/路由/错误处理）请通过 Skill tool 加载 **`reef:reef-style-frontend`** 获取。

## 工作流

### 1. 找参考实现

在动手之前，先在已有代码中找一个同类实现。优先搜索当前模块目录：

```bash
# 替换 <module> 为当前模块名
find client/src/ -path "*/<module>/*" -type f

# 找最近修改的同类文件（使用 fork-point 避免全量历史）
FORK_POINT=$(git merge-base "$(git reflog --date=local | grep "checkout: moving from.* to $(git rev-parse --abbrev-ref HEAD)$" | head -1 | sed -n 's/.*from \([^ ]*\) to .*/\1/p' || echo main)" HEAD)
git diff "$FORK_POINT"..HEAD --diff-filter=M --name-only
```

**规则**：不凭空写新文件。先读一个真实存在的同类文件，理解模式后再动手。

### 2. 🔴 加载编码规范（硬性门禁）

> **必须先通过 Skill tool 加载 `reef:reef-style-frontend`，阅读 `quick-reference.md` 了解核心编码规范，并根据当前变更类型阅读对应的维度规范文件（框架规范、UI 组件库规范、CSS 方案、TypeScript 配置、测试框架等）。完成后方可进入后续代码编写步骤。未加载 code-style 技能不得编写代码，否则视为违反工作流纪律。**

加载完成后，AI MUST 输出以下声明：

```
✅ [CODE-STYLE] 已加载前端编码规范（quick-reference + 必要维度规范），所有新增/修改代码将遵循项目编码规范。
```

涉及库/框架 API 用法时，使用 context7 获取最新文档：`resolve-library-id` → `query-docs`。

### 3. 获取设计数据

如果当前变更关联了设计工具数据（从 `design.md` 或 Issue context 中可获取 `fileKey` 和 `nodeId`），通过运行时能力映射检测可用的设计工具 MCP 服务加载设计节点数据。

运行时 AI 从 `.claude/settings.json` → `deepstorm.mcpCapabilities` 中感知可用的设计工具 provider，读取 `.claude/skills/deepstorm-mcp-figma-read/SKILL.md` 了解工具调用方式。使用 design_tools MCP 工具获取设计节点数据：

```bash
<design_tool_mcp_get_data>(fileKey: "<fileKey>", nodeId: "<nodeId>")
```

从返回的节点结构中提取实现所需的设计 token：

- **尺寸**：节点宽高、间距、内边距
- **颜色**：填充色、边框色、文字色
- **排版**：字号、字重、行高
- **布局**：Flex/Grid 方向、对齐方式、Auto Layout 属性

设计数据用于指导 UI 实现，无需另外编写文档中转。如果无可用设计工具 MCP 服务则跳过。

### 4. 编写代码

阅读本技能目录下的 `steps.md` 了解当前框架的编码步骤顺序和核心约束。编写过程中逐单元对照 `reef:reef-style-frontend` 中对应章节检查。

**注释原则**：关键组件、自定义 Hooks / Composables / Service 和非直观逻辑添加必要的注释说明用途，简单模板代码可不加。
**注释语言**：代码注释统一使用中文，专有名词/技术术语（如 Signal、Pipe、Component、Service、httpResource 等）保留英文。

### 5. 运行验证

先快速验证，写完后全量检查：

```bash
# 快速验证（秒级，确保编译和类型通过）
pnpm lint
pnpm typecheck

# 最终验证（提交前）
pnpm lint && pnpm typecheck && pnpm test
```

### 6. 🔴 提交前自检（后置检查）

重新加载 `reef:reef-style-frontend` 技能，逐项对照所有规范要求检查本变更中的每处代码修改。**检查未通过不得提交。**
