## MODIFIED Requirements

### Requirement: oceanus-tide Agent 配置

后端 SHALL 封装一个名为 `oceanus-tide` 的自定义 Agent，配置面向网页聊天环境的系统提示词和工具集。

#### Scenario: Agent 初始化配置

- **WHEN** 后端调用 `SDK.query()`
- **THEN** SHALL 使用以下配置：
  - `agent: 'oceanus-tide'`
  - `model: 'claude-sonnet-5'`
  - `effort: 'low'`
  - `thinking: { type: 'disabled' }`（禁用思考块以加速响应）
  - `maxTurns: <env AGENT_MAX_TURNS>`（默认 15，最多 15 轮工具调用）
  - `maxBudgetUsd: <env AGENT_MAX_BUDGET_USD>`（默认 1.00，单次 query 预算硬顶）
  - `skills: 'all'`（启用所有可用 Skill）
  - `settingSources: ['project']`（从项目 .claude/ 目录加载设置）
  - `includePartialMessages: true`
  - `sessionStore: FileSystemSessionStore`（文件系统持久化）

#### Scenario: Agent 系统提示词（网页环境适配）

- **WHEN** Agent 初始化
- **THEN** 系统提示词 SHALL 包含以下网页环境适配指令：
  - 告知 Agent 在网页聊天环境中运行，不是 Claude Code 终端
  - 不要求用户执行 `/clear` 等终端命令（网页中无效）
  - tide-discuss 提到"引导 /clear"时，直接告知用户"我们开始新的需求讨论"
  - 所有对话通过网页消息完成，用户只能打字回复
- **THEN** Agent 核心能力描述 SHALL 为：识别需求讨论意图 → 加载 tide-discuss Skill → 严格按工作流引导用户

#### Scenario: Agent 工具集

- **WHEN** Agent 执行推理
- **THEN** 可用工具 SHALL 为：`Skill`, `Read`, `Write`, `Bash`, `Grep`, `Glob`, `Edit`, `WebSearch`, `WebFetch`
- **THEN** Skill 工具 SHALL 用于加载 tide-discuss 等已安装的 Skill
- **THEN** 文件系统工具（Read/Write/Bash 等）SHALL 用于在项目目录中执行操作
