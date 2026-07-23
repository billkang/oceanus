## ADDED Requirements

### Requirement: 发送消息
用户可在聊天输入框中发送消息，消息转发给 Agent SDK 处理，不持久化到数据库。

#### Scenario: 发送文本消息
- **WHEN** 用户在输入框中输入消息并发送
- **THEN** 消息显示在聊天窗口中，同时转发给 Agent SDK 处理

#### Scenario: 发送空消息
- **WHEN** 用户尝试发送空消息或仅空白字符
- **THEN** 发送按钮不可用，或提交后被忽略

### Requirement: SSE 流式推送
AI 响应通过 SSE 实时推送到前端，前端流式渲染。

#### Scenario: 接收文本块
- **WHEN** SDK 返回 content_block_start (text)
- **THEN** 前端开始渲染一个新的文本块
- **WHEN** SDK 返回 content_block_delta (text_delta)
- **THEN** 前端追加流式文本到当前文本块
- **WHEN** SDK 返回 content_block_stop
- **THEN** 当前文本块渲染完成

#### Scenario: AI 状态提示
- **WHEN** SDK 开始处理 tool_use
- **THEN** 前端显示"正在分析需求…"或"正在生成 PRD…"等文字状态提示
- **WHEN** tool_use 完成
- **THEN** 状态提示消失

#### Scenario: SSE 断线重连
- **WHEN** SSE 连接意外断开（网络波动等）
- **THEN** 前端自动重连，重连后通过 SDK getSessionMessages() 补齐最新消息

### Requirement: 读取历史消息
历史消息通过 SDK 的 getSessionMessages() 读取，不走数据库。

#### Scenario: 加载会话聊天记录
- **WHEN** 用户切换或重新打开一个会话
- **THEN** 前端调用 GET /api/sessions/:id/messages，后端从 SDK 读取并返回消息列表
