## ADDED Requirements

### Requirement: 首条消息后才创建 Session 记录

Session 数据库记录不得在页面加载或任何预备阶段创建。Session 记录的创建时机必须是：用户已输入消息并点击发送，后端从 SDK `system/init` 事件中捕获真实 `session_id` 后，才写入数据库。

#### Scenario: 首次消息创建 Session

- **WHEN** 用户输入消息并点击发送
- **THEN** 前端 POST `/api/v1/chat` 不携带 `sessionId`
- **THEN** 后端调用 SDK 获取 `session_id`
- **THEN** 后端向数据库写入 Session 记录
- **THEN** SSE 流首事件返回 `sdkSessionId`
- **THEN** 前端保存此 `sdkSessionId` 用于后续消息

#### Scenario: 页面加载不创建 Session

- **WHEN** 用户打开聊天页面
- **THEN** 前端不发起任何创建 Session 的请求
- **THEN** 前端显示空的聊天界面（无空会话占位）

#### Scenario: 项目切换后的首次消息

- **WHEN** 用户在项目 A 的聊天页面首次发送消息
- **THEN** 前端传递 `projectId`
- **THEN** 后端创建会话时关联该 `projectId`
- **THEN** Session 记录写入数据库

### Requirement: Session 创建失败时优雅降级

如果 SDK init 事件捕获成功但数据库写入失败，系统应适当处理而非留下脏状态。

#### Scenario: 数据库写入失败的回滚

- **WHEN** SDK 已返回 `session_id` 但数据库 Session 创建失败
- **THEN** SSE 流中发出 `error` 事件，描述创建失败
- **THEN** 前端提示用户重试
