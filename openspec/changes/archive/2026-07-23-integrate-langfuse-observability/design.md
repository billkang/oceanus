## Context

Oceanus 目前处于 MVP 阶段，后端使用 NestJS + Claude Agent SDK 提供 AI 讨论能力。当前存在两个可观测性缺口：

1. **LLM 调用链不可见**：Agent 每次 `query()` 内部调了哪些工具、消耗了多少 Token、何时出错，完全不可查
2. **日志仅输出控制台**：NestJS 默认 Logger 只写 stdout，没有落盘、没有结构化、无法追溯

同时，前端 Angular 已通过 `package.json` 新增 `pino` 和 `nestjs-pino` 依赖（来自上次未完成的接入尝试）。

**现行架构关键特征：**
- Agent `query()` 调用封装在 `agent.service.ts`，返回 `AsyncGenerator` 流
- `chat.service.ts` 消费该流，通过 `mapSdkMessageToSseEvents()` 转换为 SSE 事件推送到前端
- SDK 支持 `hooks` 回调（`SessionStart`、`PostToolUse`、`SessionEnd` 等），可用于注入观测逻辑
- SDK 还支持 `otelHeadersHelper` 配置项，可指向输出 OTel 传播头的脚本
- 日志使用 NestJS 内置 `Logger`（`@nestjs/common`），分散在各模块中
- `docker-compose.yml` 已有 PostgreSQL 和 Langfuse 服务定义

## Goals / Non-Goals

**Goals:**
- 将 Claude Agent SDK 每次 `query()` 的调用链、Token 消耗、工具执行、错误信息推送到 Langfuse
- 用 Pino 替换 NestJS 默认 Logger，支持控制台 + 文件双输出，`logs/{projectId}/{sessionId}.log` 目录结构
- 每次 HTTP 请求自动生成 traceId，关联请求链路日志
- `docker-compose.yml` 新增 ClickHouse + Redis，Langfuse 走完整生产配置

**Non-Goals:**
- 不替换 FileSystemSessionStore（SDK 的 JSONL 会话文件继续保留）
- 不替代业务日志（NestJS Logger 的现有使用模式保留，底层切换为 Pino）
- 不做历史数据回填（Langfuse 只记录接入后的新数据）
- 不做自定义告警规则
- 不做 ELK/Loki 对接（JSON 格式已预留，后续独立项目做）
- 不修改前端 Angular 代码

## Decisions

### D1: Langfuse 接入方式

**决策：SDK Hooks 为主，不依赖 OTel 自动导出。**

| 因素 | 评估 |
|------|------|
| SDK `otelHeadersHelper` | 路径指向外部脚本，适合 CLI 场景；在 NestJS 进程内调用不自然 |
| SDK Hooks | `SessionStart`/`PostToolUse`/`SessionEnd` 可直接在进程内回调，与 NestJS DI 兼容 |
| 第三方 OTel SDK | 需要额外自动埋点依赖，且 SDK 内部调用链在 Stream 中已暴露 |

**方案：**
1. 新增 `LangfuseService`（封装 `langfuse-node` SDK）
2. 在 `agent.service.ts` 的 `query()` 调用中注册 hooks：
   - `SessionStart` hook → 创建 Langfuse trace
   - `PostToolUse` hook → 创建 tool span
   - `PostToolUseFailure` hook → span 标记 error
   - `SessionEnd` hook → finalize trace
3. Token 用量从 SDK 流事件的 `message_delta` 中提取（已有 `mapSdkMessageToSseEvents` 处理路径），传入 trace 的 usage 字段

**后续可选升级：** 如果 SDK 未来提供原生 OTel exporter，可切换到 OTel 导出模式，Hooks 作为补充。

### D2: Langfuse Trace 结构

每个 HTTP 请求 → 一个 Langfuse Trace。

```
Trace (langfuse_trace)
├── name: "oceanus-agent-query"
├── sessionId: <oceanus-session-uuid>
├── tags: ["project:<projectId>", "session:<sessionId>"]
├── Span: "agent-query" (根 span)
│   ├── Span: "tool-Skill" (每个工具调用一个 span)
│   ├── Span: "tool-Read"
│   └── ...
└── usage: { input: N, output: M }
```

### D3: Pino 日志架构

使用 `nestjs-pino` 的 `LoggerModule.forRoot()` 注入，替换 `@nestjs/common` 的 Logger。

```
应用日志流向:

HTTP 请求 → traceId 生成 (genReqId)
         → LoggerModule (nestjs-pino)
              ├── 控制台输出 (pino-pretty, dev 环境)
              └── 文件输出 (pino/file transport)
                   └── logs/{projectId}/{sessionId}.log
```

**关键配置：**
- `pino-http` 自动为每个请求生成 `req.id`（我们自定义 `genReqId` 为 UUID v4 格式的 `traceId`）
- 文件输出通过 `pino-multi-stream` 或自定义 transport 实现，根据运行时获取的 projectId/sessionId 写入对应路径
- `logs/` 目录加入 `.gitignore`

### D4: traceId 实现

使用 `nestjs-pino` 的内置机制：

```
genReqId: () => crypto.randomUUID()
```

- 每次请求自动生成 UUID v4 作为 traceId
- `nestjs-pino` 的 `LoggerModule` 在请求上下文中关联 traceId
- 所有日志行自动包含 `traceId` 字段
- 不信任客户端传入的 `X-Trace-Id`（忽略请求头）

### D5: ClickHouse + Redis 基础设施

`docker-compose.yml` 新增：
- `clickhouse/clickhouse-server:latest`（端口 8123 HTTP, 9000 Native）
- `redis:7-alpine`（端口 6379）
- Langfuse 配置 `CLICKHOUSE_URL` 和 `REDIS_URL`

Langfuse 将 ClickHouse 用于分析查询，Redis 用于缓存和队列。

### D6: 依赖包

| 包 | 用途 | 类型 |
|----|------|------|
| `nestjs-pino` | NestJS Pino 集成（替换 Logger） | 运行时依赖 |
| `pino` | 结构化日志核心 | 运行时依赖 |
| `pino-pretty` | 开发环境控制台美化输出 | 运行时依赖（或 devDep） |
| `langfuse` | Langfuse Node.js SDK | 运行时依赖 |
| `@nestjs/cls` | 异步上下文追踪（可选，如果 nestjs-pino 自带不足） | 运行时依赖 |

> 注：`nestjs-pino`、`pino`、`pino-pretty` 已在 `client/package.json` 中出现（上次前端接入尝试遗留）。本次在 `server/package.json` 安装正确版本。

### D7: 日志级别策略

| 环境 | 控制台级别 | 文件级别 | 识别方式 |
|------|-----------|----------|---------|
| development | debug | debug | `NODE_ENV !== 'production'` |
| staging | info | info | `NODE_ENV === 'production'` + `OCEANUS_ENV=staging` |
| production | warn | info | `NODE_ENV === 'production'` |

## Risks / Trade-offs

| 风险 | 缓解措施 |
|------|----------|
| Langfuse 服务不可用时阻塞主流程 | LangfuseService 使用 `onModuleInit` 延迟初始化，启动失败只记录警告，不抛异常；所有方法 try/catch 静默降级 |
| SDK Hooks 在 `query()` 的异步流中可能丢失上下文 | 使用 `Map<sessionUuid, LangfuseTraceEntry>` 在 hooks 之间传递 trace 引用 |
| Pino 替换 NestJS Logger 后，现有 `this.logger.error()` 调用格式可能变化 | `nestjs-pino` 的 `Logger` 实现了 NestJS 的 `LoggerService` 接口，兼容 `log/warn/error/debug/verbose` |
| 按会话分文件日志在高并发下可能产生大量文件描述符 | 使用 `pino-multi-stream` 或 `pino/file` 的 `destination` 按需打开 fd；会话不活跃超时后关闭 |
| ClickHouse 首次启动初始化耗时较长（10-30s） | Langfuse 容器配置 `depends_on` 等待 ClickHouse healthy；README 注明首次启动等待时间 |
| Langfuse trace 中 Token 用量可能不精确（SDK 流中 usage 信息出现时机不确定） | 只记录能获取到的 usage；缺失时 trace 正常生成但不含 usage |

## Migration Plan

### 实施步骤

1. **基础设施（docker-compose）**：新增 ClickHouse + Redis 服务，更新 Langfuse 环境变量
2. **依赖安装**：在 `server/` 安装 `nestjs-pino`、`pino`、`pino-pretty`、`langfuse`
3. **Logger 替换**：
   - `main.ts`：引入 `nestjs-pino` 的 Logger，替换 `Logger` 实例
   - `app.module.ts`：import `LoggerModule.forRoot()`
   - 各 service/controller：从 `@nestjs/common` 注入 Logger → `nestjs-pino` Logger
4. **LangfuseService**：新建 `src/common/langfuse/langfuse.service.ts`，封装 trace generation
5. **AgentService hooks**：在 `query()` 调用中注入 Langfuse hooks
6. **traceId**：`genReqId` 配置自带，无需额外中间件
7. **日志目录**：创建 `.gitignore` 条目，`main.ts` 中确保 `logs/` 目录存在
8. **.env.example**：添加 ClickHouse/Redis 相关说明（如果 Langfuse 需要额外配置）

### 回滚策略

- Logger 替换：将 `LoggerModule.forRoot()` 注释掉即可恢复 NestJS 默认 Logger
- Langfuse：`LANGFUSE_BASE_URL` 不设置时，LangfuseService 自动跳过初始化，无运行时影响
- docker-compose：移除 ClickHouse/Redis/Langfuse 服务不影响 Oceanus 主流程（PG 独立运行）

## Open Questions

（已在提案阶段全部确认，无新增 open questions）
