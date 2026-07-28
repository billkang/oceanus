## 1. SigNoz 部署（docker-compose）

- [ ] 1.1 在 `docker-compose.yml` 新增 SigNoz 容器定义（signoz、signoz-otel-collector、signoz-clickhouse、signoz-zookeeper）
- [ ] 1.2 复制 SigNoz 官方 OTel Collector 配置到 `infra/otel-collector-config.yaml`
- [ ] 1.3 从 `docker-compose.yml` 移除 Grafana、Loki、Promtail 容器定义
- [ ] 1.4 移除 Loki/Grafana 的数据卷声明（`loki_data`、`grafana_data`）
- [ ] 1.5 执行 `docker compose up -d` 验证 SigNoz 启动，访问 `http://localhost:8080`

## 2. OTel 日志接入（后端）

- [ ] 2.1 安装 OpenTelemetry 依赖：`@opentelemetry/sdk-node`、`@opentelemetry/exporter-logs-otlp-http`、`@opentelemetry/instrumentation-pino`
- [ ] 2.2 创建 `server/src/logging-otel.ts`，初始化 OTel SDK 并配置 Pino instrumentation
- [ ] 2.3 在 `main.ts` 入口最前面 import `logging-otel.ts`
- [ ] 2.4 配置 OTel Collector endpoint 指向容器内地址 `http://signoz-otel-collector:4318`

## 3. 验证与清理

- [ ] 3.1 启动后端，在 SigNoz UI 的 Logs Explorer 中搜索 `service.name = "oceanus-server"`，确认日志按时间倒序出现
- [ ] 3.2 验证日志自动关联 trace_id：在任意 controller 方法内添加一条 logger.info，检查 SigNoz 中对应日志记录包含 `trace_id` 和 `span_id` 字段
- [ ] 3.3 移除旧数据卷：`docker volume rm oceanus_loki_data oceanus_grafana_data`（如存在）
- [ ] 3.4 执行 `docker stop oceanus-otel-collector`，确认后端继续运行且请求正常返回；重启 Collector 后日志恢复写入（无需重启后端）

## 4. 文档更新

- [ ] 4.1 更新 `docs/2-architecture/overview.md`：修正四层架构图中基础设施层，更新端口表（移除 Loki/Grafana 端口，添加 SigNoz 端口）
- [ ] 4.2 更新 `docs/2-architecture/data-model.md`：无需修改（日志存储不影响数据模型）
- [ ] 4.3 更新 `docs/5-operations/` 下相关运维文档
