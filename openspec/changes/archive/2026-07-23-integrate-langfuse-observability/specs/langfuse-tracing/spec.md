## ADDED Requirements

### Requirement: SDK 调用链追踪
系统 SHALL 将 Claude Agent SDK 的每次 `query()` 调用产生的 OpenTelemetry span 导出到 Langfuse。
导出范围 SHALL 包含：工具调用链（tool name、入参、出参）、Agent 步骤顺序、步骤耗时。

#### Scenario: 正常调用链追踪
- **WHEN** 用户发送一条对话消息
- **THEN** Langfuse 面板中出现对应的 trace，包含 `tools`、`steps`、`input`、`output` 等 span

#### Scenario: 多工具调用追踪
- **WHEN** Agent 在一次响应中调用了 3 个工具
- **THEN** Langfuse trace 中包含 3 个对应的 tool span，按执行顺序排列

### Requirement: Token 消耗记录
系统 SHALL 在每个 trace 中记录 input token 和 output token 消耗。
系统 MUST 通过 Langfuse 的 `usage` API 字段上报 token 计数。

#### Scenario: Token 统计
- **WHEN** 一次 SDK query 完成
- **THEN** Langfuse trace 的 usage 段显示 inputTokens 和 outputTokens

### Requirement: 错误追踪
系统 SHALL 将 SDK 调用异常捕获并记录到 Langfuse。
系统 MUST 在 span 上标记 `status = ERROR`，附带错误消息和堆栈。

#### Scenario: SDK 调用异常
- **WHEN** Agent SDK 抛出异常（如 API 超时、模型不可达）
- **THEN** Langfuse 对应 trace 标记为红色 error 状态

#### Scenario: 工具执行失败
- **WHEN** Agent 调用的工具返回错误
- **THEN** 该工具 span 标记为 error，tool output 中包含错误详情

### Requirement: 接入方式 — SDK Hooks
系统 SHALL 通过 Claude Agent SDK 的 Hook 机制导出数据，不依赖 OTel。
使用 `SessionStart`/`PostToolUse`/`PostToolUseFailure`/`SessionEnd` 四个 Hook 点，
在每个 Hook 回调中直接调用 Langfuse SDK 创建 trace 和 span。

#### Scenario: hooks 创建 trace
- **WHEN** 系统启动时读取了 `LANGFUSE_BASE_URL` 和 LANGFUSE_* 密钥
- **THEN** `SessionStart` hook 调用 `LangfuseService.createTrace()` 创建新的 Langfuse trace

#### Scenario: hooks 记录工具调用
- **WHEN** Agent 完成一个工具调用
- **THEN** `PostToolUse` hook 调用 `LangfuseService.createToolSpan()` 记录入参、出参和耗时

### Requirement: 按项目/会话聚合
从 trace 中 SHALL 可区分 project 和 session。trace 的 `tags` 或 `sessionId` 字段 SHALL 携带当前 projectId 和 sessionId。

#### Scenario: 项目维度筛选
- **WHEN** 在 Langfuse 面板按 `project:xxx` 过滤
- **THEN** 只显示该项目相关的 traces

### Requirement: 基础设施 — ClickHouse + Redis
docker-compose.yml SHALL 新增 ClickHouse 和 Redis 服务。
Langfuse 服务 SHALL 配置为使用 ClickHouse 做分析存储，使用 Redis 做缓存和队列。

#### Scenario: 服务启动
- **WHEN** 执行 `docker compose up -d`
- **THEN** ClickHouse（端口 8123/9000）、Redis（端口 6379）、Langfuse（端口 3000）均已就绪

#### Scenario: Langfuse 连接 ClickHouse
- **WHEN** Langfuse 容器启动
- **THEN** 其 `DATABASE_URL` 指向 PostgreSQL，`CLICKHOUSE_URL` 指向 ClickHouse

### Requirement: 环境变量配置
系统 SHALL 新增以下环境变量：

| 变量名 | 用途 | 必填 |
|--------|------|------|
| `LANGFUSE_PUBLIC_KEY` | Langfuse 公钥 | 是 |
| `LANGFUSE_SECRET_KEY` | Langfuse 私钥 | 是 |
| `LANGFUSE_BASE_URL` | Langfuse 服务地址 | 是 |

#### Scenario: 环境变量缺失
- **WHEN** `LANGFUSE_BASE_URL` 未设置
- **THEN** 系统跳过 Langfuse 初始化，不报错，不影响主流程

### Requirement: 不替换 FileSystemSessionStore
Langfuse 作为可观测性附加层，SHALL NOT 替换或影响 SDK 现有的 FileSystemSessionStore 行为。

#### Scenario: 会话文件仍存在
- **WHEN** 启用 Langfuse 后完成一次对话
- **THEN** `sessions/` 目录下的 JSONL 文件仍然正常生成
