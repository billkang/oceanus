# chat-streaming Specification

## Purpose

Oceanus 网页聊天核心交互能力：消息通过 SSE 实时流式收发，支持按钮状态切换、队列 UI 提示、SDK 事件映射、流后处理管线、滚动管理、错误重试等前端聊天行为。

## Requirements

### Requirement: 发送消息

用户 SHALL 可在聊天输入框中发送消息，通过统一端点 `POST /api/v1/chat`（`action: message`）转发给 Agent SDK 处理，不持久化到数据库。新会话不传 `sessionId`，后续消息携带 `sessionId` 通过 SDK 的 `resume` 机制续传。

出于并发控制，请求可能进入队列等待。

#### Scenario: 发送文本消息（新会话，直接处理）

- **WHEN** 并发未超限，用户在输入框中输入消息并发送
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "你好", projectId: 1 }`
- **THEN** 后端通过并发守卫检查 → 活跃请求数未超限 → 直接调用 Agent SDK
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** SSE 流首事件为 `{ type: "session_created", data: { sdkSessionId: "sdk-uuid-xxx" } }`
- **THEN** SSE 流后续事件为 SDK 回复内容（`message_delta`、`tool_use` 等）
- **THEN** 前端保存 `sdkSessionId` 用于后续消息

#### Scenario: 发送文本消息（排队处理）

- **WHEN** 并发超限，请求进入队列
- **THEN** SSE 流首事件为 `{ type: "queued", data: { position: 3, estimatedWait: "约 30 秒" } }`
- **THEN** 队列位置前移时收到 `queue_position` 事件
- **THEN** 出队开始执行时收到 `dequeued` 事件
- **THEN** 后续事件与正常处理一致（`session_created`、`message_delta` 等）

#### Scenario: 发送文本消息（续传）

- **WHEN** 同一会话的用户发送后续消息
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "message", content: "继续", sessionId: "sdk-uuid-xxx" }`
- **THEN** 后端通过并发守卫检查 → 可执行时调用 `SDK.query({ resume: sessionId })`
- **THEN** SSE 流实时推送后续事件（`message_delta`、`tool_use` 等）

#### Scenario: 同一会话新消息中断旧消息（并发超限时）

- **WHEN** 同一 sessionId 已有活跃请求（在执行中或队列中），新消息到达
- **THEN** 旧请求被中断（SDK interrupt + 从队列移除）
- **THEN** 新消息入队或直接执行

#### Scenario: 发送空消息

- **WHEN** 用户尝试发送空消息或仅空白字符
- **THEN** 抛出 400 错误："消息内容不能为空"

#### Scenario: 不存在的 sessionId 返回 404

- **WHEN** 前端携带一个数据库中不存在的 `sessionId`
- **THEN** 后端返回 404 错误
- **THEN** SSE 流中发出 `error` 事件

### Requirement: SSE 流式推送

AI 响应 SHALL 通过 SSE 实时推送到前端，前端流式渲染。

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

### Requirement: 发送/中断/取消排队按钮状态切换

输入区右下角的按钮 SHALL 根据流式状态切换功能：非流式中为发送按钮，流式中为中断按钮，排队等待中为取消排队按钮。三个状态共享同一按钮位置，使用 `@if/@else` 控制流实现切换。

#### Scenario: 非流式状态下显示发送按钮

- **WHEN** `isStreaming()` 为 false 且 `queuePosition()` 为 null
- **THEN** 按钮显示为渐变色（indigo→violet）纸飞机图标
- **THEN** 输入为空时按钮禁用
- **THEN** 点击触发 `send()` 方法

#### Scenario: 流式状态下显示中断按钮

- **WHEN** `isStreaming()` 为 true
- **THEN** 按钮切换为深灰色方块图标
- **THEN** 点击触发 `cancel()` 方法中断 SSE 流

#### Scenario: 排队等待状态下显示取消按钮

- **WHEN** 请求已入队但尚未开始执行（`queuePosition()` 不为 null）
- **THEN** 按钮显示为"取消排队"文字状态
- **THEN** 点击触发 `cancel()` 从队列中移除请求

### Requirement: 队列 UI 状态提示

前端 SHALL 在 SSE 流收到排队相关事件时展示对应的 UI 状态。

#### Scenario: 显示排队提示

- **WHEN** SSE 流收到 `queued` 事件
- **THEN** 助理消息气泡位置显示排队提示卡片："您的请求已排队，前方还有 N 位"
- **THEN** 卡片样式为等待态（琥珀色），非错误态

#### Scenario: 排队位置更新

- **WHEN** SSE 流收到 `queue_position` 事件
- **THEN** 排队提示卡片的排队数字更新为最新位置

#### Scenario: 出队执行

- **WHEN** SSE 流收到 `dequeued` 事件
- **THEN** 排队提示卡片移除
- **THEN** 前端创建助理消息气泡（`MessageStart` 事件到达时）

### Requirement: isStreaming 标志位时序

发送消息时 `isStreaming` 标志位 SHALL **在调用 SSE API 之前**立即设置为 true，而非等待首个 SSE 事件。这是防止竞态条件的关键设计。

#### Scenario: 首条消息发送时保护用户消息

- **WHEN** 用户点击发送按钮（新会话，无 sessionId）
- **THEN** `isStreaming.set(true)` 在 `chatService.sendMessage()` 调用之前执行
- **THEN** 用户消息已添加到 `messages[]` 数组
- **WHEN** SSE 流返回 `session_created` 事件 → 父组件设置 `sessionId` 信号 → effect() 检测到 sessionId 变化
- **THEN** effect() 检查 `isStreaming()` 为 true → 跳过 `loadHistory()` → 用户消息保留在内存中

#### Scenario: 续传消息发送时标志位行为

- **WHEN** 用户在已有会话中发送消息（sessionId 不变）
- **THEN** `isStreaming.set(true)` 仍然在 SSE API 调用之前执行
- **THEN** sessionId 无变化 → effect() 不触发 → 无竞态风险
- **THEN** 标志位在 `stream_complete` 或 `error` 事件后恢复为 false

#### Scenario: 重试消息发送时标志位行为

- **WHEN** 用户重试失败的消息（`retry()`）
- **THEN** `isStreaming.set(true)` 同样在 SSE API 调用之前执行
- **THEN** 与 `send()` 保持一致的时序保证

### Requirement: SDK 消息到 SSE 事件映射

后端 ChatService SHALL 将 SDK AsyncGenerator 产生的每条 `SDKMessage` 映射为一个或多个 `SseEvent`，根据消息类型和内容块类型进行精细化处理。

#### Scenario: 空文本块过滤

- **WHEN** SDK 返回 `content_block_start` 且 `block.type === 'text'` 但 `block.text` 为空或仅空白字符
- **THEN** 后端将 block 标记为 `text_pending` 状态，暂不发出 `MessageStart` 事件
- **WHEN** 后续 `text_delta` 到达且内容非空
- **THEN** 后端先发出 `MessageStart`（创建前端气泡），再发出 `MessageDelta`（追加文本）
- **WHEN** `content_block_stop` 到达时 block 仍为 `text_pending`（无实际内容）
- **THEN** 后端直接忽略，不创建空白助理气泡
- **RATIONALE**: 防止 SDK 空白 text block 在前端产生无内容的幽灵消息气泡

#### Scenario: Thinking 内容块处理

- **WHEN** SDK 返回 `content_block_start` 且 `block.type === 'thinking'`
- **THEN** 后端发出 `tool_in_progress` 事件，status 为 "思考中..."
- **WHEN** thinking block 结束（`content_block_stop`）
- **THEN** 后端发出 `tool_in_progress` 事件，status 为 "思考结束，正在生成回复..."

#### Scenario: Prompt Suggestion 映射

- **WHEN** SDK 返回 `msg.type === 'prompt_suggestion'` 且包含 `suggestion` 字段
- **THEN** 后端将其映射为 `tool_options` SSE 事件，`options` 数组包含该 suggestion 字符串

#### Scenario: Tool Use 状态提示

- **WHEN** SDK 返回 `content_block_start` 且 `block.type === 'tool_use'`
- **THEN** 后端发出 `tool_in_progress` 事件，status 格式为 "正在调用工具: {toolName}..."
- **WHEN** tool_use block 结束（`content_block_stop`，block stack 中为 `tool_use`）
- **THEN** 后端发出 `tool_complete` 事件

#### Scenario: message_stop 清空块栈

- **WHEN** SDK 返回 `msg.type === 'stream_event'` 且 `event.type === 'message_stop'`
- **THEN** 后端清空 block stack，发出 `message_complete` 事件

### Requirement: 流完成后处理管线

每条消息的 SSE 流完成后，后端 SHALL 按固定管线执行后处理：标题更新 → PRD 自动提取。

#### Scenario: 标题更新触发

- **WHEN** SSE 流完成且消息轮次 ≥ 1
- **THEN** 后端发出 `tool_in_progress`（status: "正在更新标题..."）
- **THEN** 检查 Session 标题是否为 "新会话"（默认值）
- **WHEN** 标题仍为默认值
- **THEN** 取首条用户消息的前 30 字符作为标题，写入数据库
- **THEN** 发出 `title_updated` SSE 事件通知前端
- **THEN** 发出 `tool_complete` 事件
- **WHEN** 标题已被人工修改（不为 "新会话"）
- **THEN** 跳过自动更新

#### Scenario: PRD 自动提取触发

- **WHEN** 标题更新完成且累计响应文本 ≥ 50 字符
- **THEN** 后端发出 `tool_in_progress`（status: "正在分析PRD..."）
- **THEN** 检测响应文本是否包含 PRD 标记（`# PRD`、`# 产品需求`、`产品需求文档`、`## 功能需求` 等）
- **WHEN** 检测到 PRD 标记
- **THEN** 提取标题（优先使用 `# ` 一级标题），将完整响应文本作为 PRD 资产存入数据库
- **THEN** 发出 `asset_ready` SSE 事件（含 assetId 和 title）
- **THEN** 发出 `tool_complete` 事件
- **WHEN** 未检测到 PRD 标记
- **THEN** 跳过 PRD 提取，不产生资产

### Requirement: **new** 会话占位符

前端 SHALL 使用 `__new__` 作为特殊会话 ID 标记，表示"用户已选择专家但尚未发送首条消息"。这不是真实的 SDK 会话 ID。

#### Scenario: 工作区创建新会话

- **WHEN** 用户在欢迎页点击"开始对话"
- **THEN** 工作区设置 `activeSessionId = '__new__'`
- **THEN** ChatComponent 识别 `__new__` → 清空消息列表，重置 `_streamSdkSessionId`，不调用 `loadHistory()`

#### Scenario: 首条消息发送时 **new** 处理

- **WHEN** ChatComponent 的 `activeSdkSessionId` getter 遇到 `__new__`
- **THEN** 返回 `undefined`（视为无 sessionId）
- **THEN** 后端 `sendAndStream()` 将 `__new__` 规范化为 `undefined`，走首条消息逻辑（无 resume）

#### Scenario: 用户选择已有会话后 **new** 被替换

- **WHEN** 用户在 `__new__` 状态下点击左侧会话列表中的已有会话
- **THEN** `activeSessionId` 从 `__new__` 变为真实 `sdkSessionId`
- **THEN** ChatComponent effect 检测到 sessionId 变化，调用 `loadHistory()` 加载历史消息

### Requirement: 技能选择器（Skills Popup）

聊天输入框左侧 SHALL 提供技能按钮（魔法棒图标），点击弹出技能列表供用户快速选择。

#### Scenario: 打开技能列表

- **WHEN** 用户点击技能按钮（流式传输中禁用）
- **THEN** 弹出 Popover 显示 6 个内置技能：需求澄清、方案对比、Demo 生成、PRD 生成、Jira 任务同步、测试用例生成
- **THEN** 每个技能显示名称和简短描述

#### Scenario: 选择技能

- **WHEN** 用户点击某个技能
- **THEN** 技能名称填入输入框，光标聚焦输入框
- **THEN** Popover 自动关闭

### Requirement: 文件拖拽上传

聊天输入区 SHALL 支持拖拽文件上传（当前为占位实现，仅打印日志）。

#### Scenario: 拖拽文件到输入区

- **WHEN** 用户拖拽文件到输入区（流式传输中忽略）
- **THEN** 输入区显示蓝色边框和"释放文件以上传"遮罩
- **WHEN** 用户释放文件
- **THEN** 遮罩消失，当前仅 console.log 文件信息（name, size）

#### Scenario: 点击上传按钮

- **WHEN** 用户点击输入区左侧的 + 按钮
- **THEN** 触发隐藏的 `<input type="file">` 文件选择对话框
- **THEN** 选择文件后同样仅打印日志（预留后续实现）

### Requirement: 滚动管理

消息列表 SHALL 自动滚动到底部，用户主动上滚查看历史时不强制滚动。

#### Scenario: 新消息自动滚动

- **WHEN** 用户消息发送或收到新的 AI 回复
- **THEN** 如果用户在底部附近（距离底部 < 80px），自动滚动到底部

#### Scenario: 用户查看历史时停止自动滚动

- **WHEN** 用户向上滚动超过阈值（80px）
- **THEN** 设置 `userScrolledUp = true`，不再自动滚动
- **THEN** 显示"滚动到底部"浮动按钮（右下角圆形按钮）

#### Scenario: 点击滚动到底部按钮

- **WHEN** 用户点击浮动按钮或发送新消息
- **THEN** 强制滚动到底部，重置 `userScrolledUp = false`，隐藏浮动按钮

### Requirement: 消息错误与重试

发送失败的消息 SHALL 展示错误状态，用户可点击重试。

#### Scenario: 用户消息发送失败

- **WHEN** SSE 流 `onError` 回调触发
- **THEN** 用户消息气泡显示为 error 状态，展示错误信息（如"发送失败"）
- **THEN** 气泡下方显示红色错误文字 + "重试"链接按钮

#### Scenario: 助理消息错误

- **WHEN** SSE 流中收到 `error` 事件
- **THEN** 当前流式助理消息标记为 error 状态，展示错误信息
- **THEN** `isStreaming` 恢复为 false

#### Scenario: 重试用户消息

- **WHEN** 用户点击失败的用户消息上的"重试"按钮
- **THEN** `onRetry()` 移除失败消息，创建新的发送中消息，重新发起 SSE 请求
- **THEN** `isStreaming.set(true)` 在 API 调用前执行（与 send() 一致）

#### Scenario: 重试失败的助理消息

- **WHEN** 用户点击失败的助理消息上的重试
- **THEN** `onRetry()` 找到前一条用户消息的文本，移除失败的助理消息，重新发送用户消息
- **THEN** 走正常的 SSE 流处理流程

### Requirement: 输入框自适应高度

Textarea 输入框 SHALL 根据内容自动调整高度，最大 150px。

#### Scenario: 单行输入

- **WHEN** 用户输入单行文本
- **THEN** textarea 高度为单行（rows=1）

#### Scenario: 多行输入

- **WHEN** 用户输入多行或粘贴长文本
- **THEN** textarea 自动扩展高度，最大 150px
- **THEN** 超过最大高度时显示垂直滚动条

#### Scenario: 发送后重置

- **WHEN** 用户发送消息后
- **THEN** 输入框清空，高度重置为单行

### Requirement: 键盘快捷键

输入框 SHALL 支持键盘快捷键操作。

#### Scenario: Enter 发送

- **WHEN** 用户按下 Enter（非 Shift、非 Ctrl/Cmd、非输入法组合中）
- **THEN** 触发 `send()` 发送消息

#### Scenario: Shift+Enter 换行

- **WHEN** 用户按下 Shift+Enter
- **THEN** 在输入框中插入换行符，不发送消息

### Requirement: 专家选择欢迎页

工作区在无活跃会话时 SHALL 展示欢迎页，引导用户选择专家。

#### Scenario: 欢迎页展示

- **WHEN** `activeSessionId` 为空（用户尚未开始对话）
- **THEN** 聊天区域显示欢迎页：项目名称 + "请选择本次会话使用的专家"
- **THEN** 展示"产品专家"卡片（当前唯一选项），标注模型为 deepseek-v4-pro
- **THEN** 专家卡片默认为选中状态（radio 样式）

#### Scenario: 开始对话

- **WHEN** 用户点击"开始对话"按钮
- **THEN** 工作区设置 `activeSessionId = '__new__'`
- **THEN** 聊天区域切换为 ChatComponent，显示空聊天界面

### Requirement: 侧栏折叠与持久化

工作区左右侧栏 SHALL 支持折叠/展开，折叠状态持久化到 localStorage。

#### Scenario: 折叠左侧栏

- **WHEN** 用户点击左侧栏折叠按钮
- **THEN** 左侧栏宽度动画过渡为 0
- **THEN** 折叠状态写入 `localStorage['oceanus_workspace_left_collapsed']`

#### Scenario: 折叠右侧栏

- **WHEN** 用户点击右侧栏折叠按钮
- **THEN** 右侧栏宽度动画过渡为 0
- **THEN** 折叠状态写入 `localStorage['oceanus_workspace_right_collapsed']`

#### Scenario: 页面重新加载恢复状态

- **WHEN** 用户刷新页面
- **THEN** 从 localStorage 读取折叠状态，恢复左右栏的展开/折叠
