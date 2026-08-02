# session-management Specification

## MODIFIED Requirements

### Requirement: 创建会话

Session 记录 SHALL 使用 SDK 的 `system/init` 事件返回的真实 `session_id` 作为唯一标识（`sdkSessionId`），而非应用自行生成的 UUID。Session 记录首次消息后才创建——用户输入消息后，后端从 SDK 捕获 `session_id` 后再写入数据库，并记录归属用户（`username`）与项目（`projectId`）。首条消息请求必须携带 `projectName`（项目 projectName），服务端据此校验成员资格并确定分区。

#### Scenario: 首次消息捕获 session_id 并创建会话

- **WHEN** 用户输入消息并发送（`action: message`，无 `sessionId`，携带 `projectName`）
- **THEN** 后端校验当前用户是该项目成员（非成员返回 404）
- **THEN** 后端调用 `SDK.query()` 不带 resume 参数
- **THEN** 后端从 `system/init` 事件中提取 `session_id`
- **THEN** 后端以该 `session_id` 作为 `sdkSessionId`，连同项目与归属用户写入数据库
- **THEN** SSE 流首事件返回该 `sdkSessionId`
- **THEN** 前端保存此 `sdkSessionId` 用于后续消息
- **NOTE**: 前端必须在消息发送时立即设置 `isStreaming=true`（在 SSE 调用之前），防止 `session_created` 事件 → `sessionId` 信号传播触发 `loadHistory()` 清空内存中的用户消息

#### Scenario: 页面加载不创建 Session

- **WHEN** 用户打开聊天页面
- **THEN** 前端不发起任何创建 Session 的请求
- **THEN** 前端显示空的聊天界面（无空会话占位）

#### Scenario: 项目切换后的首次消息

- **WHEN** 用户在项目 A 的聊天页面首次发送消息
- **THEN** 前端传递 `projectName`（项目 A 的 projectName）
- **THEN** 后端创建会话时关联该项目并记录归属用户

#### Scenario: 标题轮次自动更新

- **WHEN** 每条消息的 SSE 流完成后（`afterStreamComplete` 管线）
- **THEN** 后端检查该会话的消息轮次计数（`messageRoundCount`）≥ 1
- **THEN** 使用首条用户消息的前 30 字符作为标题（超过 30 字符加 "…"）
- **THEN** 标题更新事件通过 SSE 推送给前端
- **THEN** 数据库 Session 记录的 `title` 字段更新
- **NOTE**: 轮次计数以每条消息的 SSE 流完成为单位（`stream_complete`），而非用户消息数量

#### Scenario: 已有人工标题跳过自动更新

- **WHEN** Session 的 `title` 不为"新会话"
- **THEN** 跳过标题自动更新逻辑

#### Scenario: 数据库写入失败的回滚

- **WHEN** SDK 已返回 `session_id` 但数据库 Session 创建失败
- **THEN** SSE 流中发出 `error` 事件，描述创建失败
- **THEN** 前端提示用户重试

#### Scenario: Session 记录去 uuid

- **WHEN** 系统创建新的 Session 记录
- **THEN** Session 表 `id` 仍为自增主键
- **THEN** 不存在 `uuid` 字段
- **THEN** `sdkSessionId` 为 `@unique` 且非空

### Requirement: 会话历史列表

左侧面板 SHALL 展示当前项目下、**当前用户自己**的所有活跃会话，按时间倒序排列。其他用户的会话不展示。

#### Scenario: 多会话列表展示

- **WHEN** 项目下有多个会话
- **THEN** 左侧面板按时间倒序显示当前用户自己的会话（标题 + 最后消息时间）
- **THEN** 其他用户的会话不显示

#### Scenario: 切换会话

- **WHEN** 用户点击列表中的某个会话
- **THEN** 当前会话高亮，中间聊天面板加载该会话的聊天记录

#### Scenario: 空会话列表

- **WHEN** 项目下当前用户没有任何会话（全部已删除）
- **THEN** 展示空状态提示

### Requirement: 删除会话

用户 SHALL 可物理删除自己的会话，级联清理 `SessionEntry` 记录 + Session 数据库记录。删除时 SHALL 校验所有权（`session.username === 当前用户`），非所有者返回 404。记录清理按分区寻址（`partitionKey = 会话分区` 且 `sessionId = 该会话`），与 Session 删除在单个 Prisma `$transaction` 中原子执行，失败整体回滚，不依赖任何文件路径字段。

#### Scenario: 删除前确认

- **WHEN** 用户点击删除按钮
- **THEN** 弹出二次确认弹窗："删除后会话记录和关联资产将永久清除，确认删除？"

#### Scenario: 确认删除

- **WHEN** 用户在确认弹窗中选择"确认删除"且当前用户是该会话所有者
- **THEN** 系统在单个 Prisma `$transaction` 中删除 `SessionEntry`（`partitionKey = 会话分区` 且 `sessionId = 该会话`）与 Session 记录
- **THEN** 任一删除失败则整体回滚，不产生半删状态
- **THEN** 会话从列表中消失

#### Scenario: 非所有者删除

- **WHEN** 用户尝试删除其他用户的会话
- **THEN** 系统返回 404

#### Scenario: 取消删除

- **WHEN** 用户在确认弹窗中选择"取消"
- **THEN** 不执行任何删除操作，关闭弹窗

### Requirement: 会话 API 端点

会话管理 SHALL 通过以下 REST 端点提供服务，全部校验当前用户所有权/成员资格。会话一律由首条消息懒创建，不提供手动创建端点。

| 方法   | 路由                               | 说明                                                                 |
| ------ | ---------------------------------- | -------------------------------------------------------------------- |
| GET    | `/projects/:projectName/sessions`       | 项目会话列表（当前用户，按 lastMessageAt DESC, createdAt DESC 排序） |
| GET    | `/sessions/:sdkSessionId`          | 会话详情（含关联项目信息，仅所有者）                                 |
| GET    | `/sessions/:sdkSessionId/messages` | 会话历史消息（走 scoped store，仅所有者）                            |
| DELETE | `/sessions/:sdkSessionId`          | 删除会话（含记录清理，仅所有者）                                     |

#### Scenario: 会话历史消息所有权

- **WHEN** 当前用户请求某会话的历史消息（`GET /sessions/:sdkSessionId/messages`）
- **THEN** 服务端校验 `session.username === 当前用户`（非所有者返回 404）
- **THEN** 通过该分区的 scoped store 读取消息

#### Scenario: 会话列表排序

- **WHEN** 查询项目会话列表
- **THEN** 优先按 `lastMessageAt` 降序（有最后消息时间的在前）
- **THEN** 其次按 `createdAt` 降序（null lastMessageAt 的会话按创建时间排序）

#### Scenario: 非成员访问会话列表

- **WHEN** 用户访问非成员项目的会话列表
- **THEN** 返回 404
