## 1. 基础设施 — docker-compose 新增 ClickHouse + Redis

- [x] 1.1 docker-compose.yml 新增 ClickHouse 服务（clickhouse/clickhouse-server:latest，端口 8123/9000，健康检查）
- [x] 1.2 docker-compose.yml 新增 Redis 服务（redis:7-alpine，端口 6379，健康检查）
- [x] 1.3 更新 Langfuse 服务的 environment，添加 CLICKHOUSE_URL 和 REDIS_URL 配置
- [x] 1.4 添加 ClickHouse 和 Redis 的 volumes 定义（持久化数据）

## 2. 安装依赖

- [x] 2.1 server/package.json 添加运行时依赖：nestjs-pino、pino、langfuse
- [x] 2.2 server/package.json 添加 devDependencies：pino-pretty
- [x] 2.3 运行 `pnpm install` 安装新依赖

## 3. 环境变量与配置

- [x] 3.1 server/.env.example 添加 ClickHouse/Redis 相关环境变量注释（无需新增变量名，Langfuse 使用现有 LANGFUSE_* 变量，docker-compose 内部连接）
- [x] 3.2 server/.env.example 确认 LANGFUSE_PUBLIC_KEY、LANGFUSE_SECRET_KEY、LANGFUSE_BASE_URL 注释正确
- [x] 3.3 根目录 .gitignore 添加 `logs/` 条目
- [x] 3.4 server/ 目录下创建 `logs/.gitkeep` 占位文件

## 4. Pino 结构化日志

- [x] 4.1 server/src/app.module.ts 导入 LoggerModule.forRoot()，配置 pino-http（genReqId 为 UUID v4 格式 traceId）、控制台 pino-pretty（dev 环境）、文件 transport
- [x] 4.2 server/src/main.ts 创建 LoggerModule 实例替换 Bootstrap Logger，初始化 `logs/` 目录，使用 Pino 实例输出启动日志
- [x] 4.3 将各 service/controller 中 `@nestjs/common` 的 Logger 替换为 `nestjs-pino` 的 Logger（保持 `log/warn/error/debug/verbose` 调用不变）
- [x] 4.4 实现按 `logs/{projectId}/{sessionId}.log` 分文件的日志写入逻辑（基于当前请求上下文动态决定日志路径）

## 5. Langfuse 追踪

- [x] 5.1 创建 `server/src/common/langfuse/` 模块目录，新建 `langfuse.service.ts`（封装 langfuse-node SDK，延迟初始化，静默降级）
- [x] 5.2 创建 `server/src/common/langfuse/langfuse.module.ts`，导出 LangfuseService
- [x] 5.3 在 `server/src/app.module.ts` 导入 LangfuseModule
- [x] 5.4 修改 `server/src/agent/agent.service.ts`，在 `sendMessage()` 的 query() 调用中注入 hooks（SessionStart → 创建 trace，PostToolUse → tool span，PostToolUseFailure → error 标记，SessionEnd → finalize）
- [x] 5.5 从 SDK stream 事件中提取 usage（input/output token），更新到 Langfuse trace 的 usage 字段
- [x] 5.6 验证 Langfuse 服务不可用时（LANGFUSE_BASE_URL 未设置）不影响主流程

## 6. README 更新

- [x] 6.1 README.md 更新 "启动服务" 部分，说明 ClickHouse + Redis 需一起启动（`docker compose up -d`）
- [x] 6.2 README.md 更新 "接入 Langfuse 步骤"，补充 ClickHouse + Redis 预配要求
