## ADDED Requirements

### Requirement: SDK 初始化
后端封装 Claude Agent SDK (TypeScript)，配置国产模型作为 Provider。

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
Agent Module 加载 Tide-discuss BMAD 工作流 Skill。

#### Scenario: 自动启动讨论
- **WHEN** 新会话创建完成
- **THEN** Agent SDK 自动加载 Tide-discuss Skill，用户看到业务分析师 Mary 的介绍

#### Scenario: 事件转发
- **WHEN** Agent SDK 产生内部事件（content_block、tool_use、tool_confirm 等）
- **THEN** 后端实时转发为 SSE 事件，推送到前端

### Requirement: 用户确认交互
SDK 请求用户确认时，后端通过 SSE 推送选项，前端展示后用户选择回传 SDK。

#### Scenario: 选项推送
- **WHEN** SDK 触发 tool_confirm
- **THEN** 后端推送 tool_options SSE 事件，包含选项列表
- **WHEN** 用户选择某个选项或输入自由文本
- **THEN** 后端将用户选择回传给 SDK Agent 继续执行

### Requirement: 中断处理
用户可主动中断当前 Agent 响应。

#### Scenario: 中断响应
- **WHEN** 用户点击中断按钮
- **THEN** 后端调用 SDK cancel 接口停止当前响应，SSE 连接正常关闭
