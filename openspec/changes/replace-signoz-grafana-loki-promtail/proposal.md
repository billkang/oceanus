## Why

Oceanus 当前日志链路（Pino → stdout → Promtail → Loki → Grafana）中的核心组件 Grafana、Loki、Promtail 使用 AGPL v3 许可证。AGPL v3 是强 Copyleft 许可证，在商业化分发或嵌入场景下存在合规风险。需要在架构层面替换为宽松许可证（Apache 2.0）的方案，消除商业使用的法律隐患。

## What Changes

1. **新增 SigNoz 部署** — 在 docker-compose 中引入 SigNoz（含 OTel Collector、ClickHouse、ZooKeeper）
2. **替换日志采集链路** — 从 Promtail 文件采集改为 OpenTelemetry Pino instrumentation 直接导出
3. **移除 AGPL v3 组件** — 从 docker-compose 中移除 Grafana、Loki、Promtail 容器
4. **更新架构文档** — 同步更新 overview.md、端口表、基础设施说明

## Capabilities

### New Capabilities

- `otel-log-ingestion`: Oceanus 后端通过 OpenTelemetry SDK 将 Pino 日志导出到 OTel Collector，自动关联 trace_id，无需文件 tail
- `signoz-self-hosted`: 部署 SigNoz 单二进制版，提供日志搜索、仪表盘、告警功能，基于 ClickHouse 存储

### Modified Capabilities

- （无需修改已有 capability）

## Impact

| 领域         | 影响                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **基础设施** | docker-compose 增减容器：移除 Grafana/Loki/Promtail，新增 SigNoz/OTel Collector/ZooKeeper                                                            |
| **后端**     | 新增 `@opentelemetry/sdk-node`、`@opentelemetry/exporter-logs-otlp-http`、`@opentelemetry/instrumentation-pino` 依赖；在应用入口添加 OTel 初始化代码 |
| **文档**     | overview.md 四层架构图、基础设施说明、端口表需要更新                                                                                                 |
| **CI/CD**    | 无影响                                                                                                                                               |
| **Langfuse** | 无影响，保留做 LLM 专属观测                                                                                                                          |
