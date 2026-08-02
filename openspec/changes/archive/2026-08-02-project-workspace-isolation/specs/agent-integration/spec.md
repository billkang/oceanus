# agent-integration Specification

## Purpose

Agent SDK 集成能力变更：`query()` 携带 `cwd`（会话目录）与 `additionalDirectories`（公共 PRD 区）、工具白名单收紧（v1 禁用 Bash）、会话持久化明确为 PrismaSessionStore（Postgres），修正原有 FileSystemSessionStore 描述与代码漂移。

## MODIFIED Requirements

### Requirement: SDK 初始化

后端 SHALL 封装 Claude Agent SDK (TypeScript)，通过模型注册表选择 Provider，并根据会话分区上下文解析 Agent 工作目录（`cwd`）与公共目录（`additionalDirectories`）。

#### Scenario: SDK 配置加载

- **WHEN** 后端服务启动且模型注册表可用
- **THEN** 从模型注册表读取所选 provider 的 `baseUrl` / `modelId` / `smallFastModel` / Key 来源，配置 Agent SDK 调用

#### Scenario: 工作目录解析

- **WHEN** 构建一次 `query()` 调用
- **THEN** `cwd` 解析为会话目录 `<PROJECTS_ROOT>/<projectName>/requirements/private/<username>/<sessionId>/`（首条消息预生成 `session_id`，目录在 query 启动前已存在，见 agent-workspace-isolation「会话目录创建时点」）
- **THEN** `additionalDirectories` 指向 `<PROJECTS_ROOT>/<projectName>/requirements/shared/` 供公共 PRD 只读参考

#### Scenario: 国产模型响应

- **WHEN** Agent SDK 发起 AI 调用
- **THEN** 请求发送到所选 provider 的 `baseUrl` 配置的模型 API，而非 Claude 官方 API

#### Scenario: 注册表不可用

- **WHEN** 模型注册表缺失 / 非法 / 无可用 provider
- **THEN** 服务正常启动，但 Agent 模块返回"AI 服务未配置"错误

### Requirement: oceanus-tide Agent 配置

后端 SHALL 封装一个名为 `oceanus-tide` 的自定义 Agent，配置面向网页聊天环境的系统提示词、工具集与工作目录隔离。

#### Scenario: Agent 初始化配置

- **WHEN** 后端调用 `SDK.query()`
- **THEN** SHALL 使用以下配置：
  - `agent: 'oceanus-tide'`
  - `model: <所选 provider 的 modelId>`（由请求 `model` 参数或默认 provider 决定）
  - `cwd: <会话目录>`（`private/<username>/<sessionId>/`，Agent 工作根目录）
  - `additionalDirectories: [<项目 requirements/shared/>]`（公共 PRD 只读参考）
  - `env: { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_SMALL_FAST_MODEL }`（provider 级覆盖，逐调用注入）
  - `effort: 'low'`
  - `thinking: { type: 'enabled', budgetTokens: 4000 }`（启用思考块，预算 4000 tokens）
  - `maxTurns: <env AGENT_MAX_TURNS>`（默认 15，最多 15 轮工具调用）
  - `maxBudgetUsd: <env AGENT_MAX_BUDGET_USD>`（默认 1.00，单次 query 预算硬顶）
  - `skills: 'all'`（启用所有可用 Skill）
  - `settingSources: ['project']`（从项目 .claude/ 目录加载设置）
  - `includePartialMessages: true`
  - `sessionStore: PrismaSessionStore`（Postgres 持久化，`partitionKey = ${projectName}/${username}`）

#### Scenario: Agent 系统提示词（网页环境适配 + 路径感知）

- **WHEN** Agent 初始化
- **THEN** 系统提示词 SHALL 包含以下网页环境适配指令：
  - 告知 Agent 在网页聊天环境中运行，不是 Claude Code 终端
  - 不要求用户执行 `/clear` 等终端命令（网页中无效）
  - tide-discuss 提到"引导 /clear"时，直接告知用户"我们开始新的需求讨论"
  - 所有对话通过网页消息完成，用户只能打字回复
- **THEN** Agent 核心能力描述 SHALL 为：识别需求讨论意图 → 加载 tide-discuss Skill → 严格按工作流引导用户
- **THEN** 提示词 SHALL 说明工作目录为当前会话目录、tide-discuss skill 已随项目安装，且不包含任何硬编码的绝对仓库路径

#### Scenario: Agent 工具集（v1 禁用 Bash）

- **WHEN** Agent 执行推理
- **THEN** 可用工具 SHALL 为：`Skill`, `Read`, `Write`, `Grep`, `Glob`, `Edit`, `WebSearch`, `WebFetch`（**不含 Bash**）
- **THEN** Skill 工具 SHALL 用于加载 tide-discuss 等已安装的 Skill
- **THEN** 文件系统工具（Read/Write/Edit 等）SHALL 用于在会话目录内执行操作
- **THEN** Agent 无法经 Bash 越界读写其他项目/用户目录

#### Scenario: 写路径白名单（PreToolUse hook）

- **WHEN** Agent 发起 `Write` / `Edit` 写操作
- **THEN** PreToolUse hook SHALL 校验目标路径必须落在当前会话目录 `private/<username>/<sessionId>/` 内，否则 `deny`（additionalDirectories 的 `shared/` 对交互式 Agent 只读）
- **WHEN** Agent 发起 `Read` 操作
- **THEN** hook SHALL 放行 cwd 会话目录与 additionalDirectories 内的路径，其余拒绝
- **THEN** 交互式 Agent 的唯一写入口为自身会话目录，任何越界写被拒绝（隔离升级为准硬）
