# confirmation-ui Specification

## Purpose

前端用户确认交互能力：SDK 请求用户确认时展示选项按钮，支持"其他"自由输入，并将用户选择回传 SDK 继续执行。

## Requirements

### Requirement: 选项按钮展示

SDK 需要用户确认时，前端 SHALL 展示选项按钮供用户选择。

#### Scenario: 展示选项

- **WHEN** 前端收到 tool_options SSE 事件（包含选项列表）
- **THEN** 在聊天窗口中以按钮形式展示每个选项，用户点击即选择

#### Scenario: "其他"自由输入

- **WHEN** 选项按钮展示的同时，显示"其他"输入按钮
- **WHEN** 用户点击"其他"
- **THEN** 显示文本输入框，用户可输入自定义回复

#### Scenario: 选择后回传

- **WHEN** 用户点击选项按钮或提交其他输入
- **THEN** 前端 POST `POST /api/v1/chat` 请求体为 `{ action: "confirm", sessionId: "sdk-uuid-xxx", confirmOption: "选项内容" }`
- **THEN** 后端返回 `Content-Type: text/event-stream`
- **THEN** 首事件为 `{ type: "confirm_accepted", data: {} }`
- **THEN** 后续事件为 SDK 继续推理的流式回复（`message_delta`、`tool_use` 等）

#### Scenario: Confirm 后遇到再次 tool_options

- **WHEN** 用户确认后 SDK 又遇到选择点
- **THEN** SSE 流发出 `tool_options` 事件
- **THEN** SSE 流正常关闭（`stream_complete`）
- **THEN** 前端显示选择项供用户再次确认

### Requirement: 选项加载状态

用户选择后，按钮 SHALL 展示加载/处理中状态，防止重复点击。

#### Scenario: 选择后锁定

- **WHEN** 用户点击了某个选项
- **THEN** 所有选项按钮置灰/禁用，展示"处理中…"状态
- **WHEN** SDK 确认收到并继续处理
- **THEN** 选项区域关闭，恢复为聊天消息展示
