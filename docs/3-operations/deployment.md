# 部署说明

> 由 DeepStorm 自动创建，请根据实际部署环境更新。

## 环境

- **开发环境**：
- **测试环境**：
- **生产环境**：

## 部署步骤

1.
2.
3.

## 相关配置

- 环境变量：`LOG_LEVEL`（日志级别）、`OTEL_COLLECTOR_URL`（OTel Collector 地址）
- 数据库迁移：Prisma migrate
- CI/CD 流水线：

## 可观测性

### 日志（SigNoz）

日志采集链路：`Pino → OTel SDK（instrumentation-pino）→ OTel Collector → ClickHouse → SigNoz UI`

- **端口**：3002（SigNoz UI）
- **启动**：`docker compose up -d signoz signoz-otel-collector signoz-clickhouse signoz-zookeeper`
- **访问**：`http://localhost:3002`，Logs Explorer 中按 `service.name` 过滤
- **配置**：`server/src/logging-otel.ts`，Collector endpoint 默认指向 `signoz-otel-collector:4318`
- **重试**：OTel SDK 内置 sending_queue + retry_on_failure，Collector 临时中断不丢日志

> 详细配置见 [环境配置详解](../1-getting-started/environment.md#signoz-日志)。

### 链追踪（Langfuse）

Langfuse 继续负责 LLM 调用追踪，不受日志方案变更影响。
