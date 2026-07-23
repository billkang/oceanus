## ADDED Requirements

### Requirement: 选项按钮展示
SDK 需要用户确认时，前端展示选项按钮供用户选择。

#### Scenario: 展示选项
- **WHEN** 前端收到 tool_options SSE 事件（包含选项列表）
- **THEN** 在聊天窗口中以按钮形式展示每个选项，用户点击即选择

#### Scenario: "其他"自由输入
- **WHEN** 选项按钮展示的同时，显示"其他"输入按钮
- **WHEN** 用户点击"其他"
- **THEN** 显示文本输入框，用户可输入自定义回复

#### Scenario: 选择后回传
- **WHEN** 用户点击选项按钮或提交其他输入
- **THEN** 选择结果通过 POST /api/sessions/:id/agent/confirm 回传给后端，后端转发给 SDK

### Requirement: 选项加载状态
用户选择后，按钮应展示加载/处理中状态，防止重复点击。

#### Scenario: 选择后锁定
- **WHEN** 用户点击了某个选项
- **THEN** 所有选项按钮置灰/禁用，展示"处理中…"状态
- **WHEN** SDK 确认收到并继续处理
- **THEN** 选项区域关闭，恢复为聊天消息展示
