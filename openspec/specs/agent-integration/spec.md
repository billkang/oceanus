# agent-integration Specification

## Purpose

Oceanus 后端与 Claude Agent SDK 的集成能力：SDK 初始化与国产模型 Provider、Tide-discuss 工作流 Skill 加载、oceanus-tide 网页聊天 Agent 适配、SSE 事件转发、中断处理与 Langfuse 可观测性。

## Requirements

### Requirement: SDK 初始化

后端 SHALL 封装 Claude Agent SDK (TypeScript)，配置国产模型作为 Provider。

#### Scenario: SDK 配置加载

- **WHEN** 后端服务启动
- **THEN** 从环境变量读取 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` / `ANTHROPIC_API_KEY`，初始化 Agent SDK 实例

#### Scenario: 国产模型响应

- **WHEN** Agent SDK 发起 AI 调用
- **THEN** 请求发送到 `ANTHROPIC_BASE_URL` 配置的国产模型 API，而非 Claude 官方 API

#### Scenario: 环境变量缺失

- **WHEN** 后端启动时 `ANTHROPIC_API_KEY` 未配置
- **THEN** 服务正常启动，但 Agent 模块返回"AI 服务未配置"错误

### Requirement: Tide-discuss 加载

Agent Module SHALL 加载 Tide-discuss BMAD 工作流 Skill。

#### Scenario: 自动启动讨论

- **WHEN** 新会话创建完成
- **THEN** Agent SDK 自动加载 Tide-discuss Skill，用户看到业务分析师 Mary 的介绍

#### Scenario: 事件转发

- **WHEN** Agent SDK 产生内部事件（content_block、tool_use、tool_confirm 等）
- **THEN** 后端实时转发为 SSE 事件，推送到前端

### Requirement: 用户确认交互

SDK 请求用户确认时，后端 SHALL 通过 SSE 推送选项，前端展示后用户选择回传 SDK。

#### Scenario: 选项推送

- **WHEN** SDK 触发 tool_confirm
- **THEN** 后端推送 tool_options SSE 事件，包含选项列表
- **WHEN** 用户选择某个选项或输入自由文本
- **THEN** 后端将用户选择回传给 SDK Agent 继续执行

### Requirement: 中断处理

用户 SHALL 可主动中断当前 Agent 响应。

#### Scenario: 中断响应

- **WHEN** 用户点击中断按钮
- **THEN** 后端调用 SDK cancel 接口停止当前响应，SSE 连接正常关闭

### Requirement: oceanus-tide Agent 配置

后端 SHALL 封装一个名为 `oceanus-tide` 的自定义 Agent，配置面向网页聊天环境的系统提示词和工具集。

#### Scenario: Agent 初始化配置

- **WHEN** 后端调用 `SDK.query()`
- **THEN** 使用以下配置：
  - `agent: 'oceanus-tide'`
  - `model: 'claude-sonnet-5'`
  - `effort: 'low'`
  - `thinking: { type: 'disabled' }`（禁用思考块以加速响应）
  - `maxTurns: 20`（最多 20 轮工具调用）
  - `skills: 'all'`（启用所有可用 Skill）
  - `settingSources: ['project']`（从项目 .claude/ 目录加载设置）
  - `includePartialMessages: true`
  - `sessionStore: FileSystemSessionStore`（文件系统持久化）

#### Scenario: Agent 系统提示词（网页环境适配）

- **WHEN** Agent 初始化
- **THEN** 系统提示词包含以下网页环境适配指令：
  - 告知 Agent 在网页聊天环境中运行，不是 Claude Code 终端
  - 不要求用户执行 `/clear` 等终端命令（网页中无效）
  - tide-discuss 提到"引导 /clear"时，直接告知用户"我们开始新的需求讨论"
  - 所有对话通过网页消息完成，用户只能打字回复
- **THEN** Agent 核心能力描述：识别需求讨论意图 → 加载 tide-discuss Skill → 严格按工作流引导用户

#### Scenario: Agent 工具集

- **WHEN** Agent 执行推理
- **THEN** 可用工具为：`Skill`, `Read`, `Write`, `Bash`, `Grep`, `Glob`, `Edit`, `WebSearch`, `WebFetch`
- **THEN** Skill 工具用于加载 tide-discuss 等已安装的 Skill
- **THEN** 文件系统工具（Read/Write/Bash 等）用于在项目目录中执行操作

### Requirement: AiNotConfigured 事件

当 ANTHROPIC_API_KEY 环境变量未配置时，Agent 服务 SHALL 启动但所有 AI 功能不可用。

#### Scenario: API Key 缺失时发送消息

- **WHEN** 前端发送消息但 `ANTHROPIC_API_KEY` 未配置
- **THEN** AgentService 抛出 "AI 服务未配置" 错误
- **THEN** SSE 流中发出 `ai_not_configured` 事件
- **THEN** 前端可据此展示配置引导

#### Scenario: 服务启动时记录警告

- **WHEN** 后端启动时 `ANTHROPIC_API_KEY` 缺失
- **THEN** 服务正常启动（不崩溃）
- **THEN** 日志输出 WARN：`ANTHROPIC_API_KEY 未配置，AI 功能不可用`

### Requirement: Langfuse Hooks 集成

Agent SDK SHALL 通过 4 个 Hook 生命周期点集成 Langfuse 可观测性：SessionStart、PostToolUse、PostToolUseFailure、SessionEnd。

#### Scenario: SessionStart Hook 创建 Trace

- **WHEN** SDK 会话开始且 `session_id` 可用
- **THEN** SessionStart hook 调用 `LangfuseService.createTrace(session_id)`
- **THEN** 若 Langfuse 未配置（LANGFUSE_BASE_URL 缺失），hooks 返回空对象，静默跳过

#### Scenario: PostToolUse Hook 记录工具调用

- **WHEN** Agent 完成一个工具调用
- **THEN** PostToolUse hook 调用 `LangfuseService.createToolSpan(session_id, tool_name, tool_input, tool_response, duration_ms)`

#### Scenario: PostToolUseFailure Hook 记录工具失败

- **WHEN** 工具调用失败
- **THEN** PostToolUseFailure hook 调用 `LangfuseService.markToolError(session_id, tool_name, error)`

#### Scenario: SessionEnd Hook 结束 Trace

- **WHEN** SDK 会话结束
- **THEN** SessionEnd hook 调用 `LangfuseService.finalizeTrace(session_id)`

#### Scenario: 首条消息 Langfuse Trace 补充创建

- **WHEN** 首条消息发送时 SessionStart hook 尚未获得 session_id
- **THEN** ChatService 在捕获 `system/init` → `session_id` 后，主动调用 `langfuseService.createTrace(capturedSdkSessionId)` 补充创建 Trace
- **RATIONALE**: SessionStart hook 在 SDK query 启动时立即触发，此时 `session_id` 尚不可用；需在捕获后手动补充

### Requirement: Prompt Suggestion 处理

SDK 可能返回 `prompt_suggestion` 类型的消息，后端 SHALL 将其映射为工具选项事件。

#### Scenario: 接收 prompt_suggestion

- **WHEN** SDK 返回 `msg.type === 'prompt_suggestion'` 且包含 `suggestion` 字段
- **THEN** 后端映射为 `tool_options` SSE 事件，`options` 数组包含 suggestion 字符串
- **THEN** 前端以选项按钮形式展示供用户选择
