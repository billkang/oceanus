## Why

Oceanus 目前缺乏对 Claude Agent SDK 内部工作状态的可观测性——不知道每次 AI 响应调用了哪些工具、消耗了多少 Token、以及何时出错。同时，应用日志仅输出到控制台，没有落盘、没有结构化、无法排查历史问题。随着平台承载更多项目和用户，这两项缺失将严重影响调试效率和成本管控。

## What Changes

- **接入 Langfuse**：将 Claude Agent SDK 的调用链、Token 消耗、工具执行、错误信息推送到 Langfuse（自托管），通过 Langfuse 仪表盘可视化
- **替换日志为 Pino**：用 `nestjs-pino` 替换 NestJS 默认 Logger，支持控制台 + 文件双输出，JSON 结构化格式
- **日志按项目/会话分文件**：`logs/{project}/{session}.log` 目录结构
- **新增 traceId**：每次 HTTP 请求自动生成 traceId，关联请求链路日志
- **新增 .env 变量**：`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`
- **保留现有 FileSystemSessionStore**：Langfuse 作为额外可观测层，不替换 SDK 会话文件

## Capabilities

### New Capabilities

- `langfuse-tracing`: Claude Agent SDK 调用链和 Token 消耗追踪，通过 Langfuse 面板查看
- `structured-logging`: 基于 Pino 的结构化日志，控制台 + 文件双输出，按项目/会话分目录
- `request-tracing`: 每次 HTTP 请求自动生成 traceId，日志中携带 traceId 和 sessionId

### Modified Capabilities

- （无现有的 spec 被修改——本次全部为新增能力）

## Impact

- **后端**：新增 `nestjs-pino`、Langfuse SDK 依赖；修改 chat.service.ts、agent.service.ts、main.ts
- **配置**：`.env` 新增 Langfuse 相关变量
- **基础设施**：docker-compose.yml 已包含 langfuse 服务（PostgreSQL 复用）
- **日志**：所有现有 `Logger` 调用改为 Pino；增加日志文件目录 `.gitignore` 处理
