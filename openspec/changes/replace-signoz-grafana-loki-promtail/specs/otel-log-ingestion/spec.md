## ADDED Requirements

### Requirement: OTel 日志自动采集

Oceanus 后端 SHALL 在应用启动时自动初始化 OpenTelemetry SDK，将 Pino logger 输出的所有日志通过 OTLP 协议导出到 OTel Collector。

- 使用 `@opentelemetry/instrumentation-pino` 实现零侵入采集，无需修改现有 `logger.info/warn/error` 调用
- 日志记录 SHALL 自动包含 `trace_id` / `span_id`（当 Span 上下文存在时），支持日志-链路关联
- 初始化代码 SHALL 在应用入口最优先加载（`import` 顺序在最前），确保任何日志操作都被采集

#### Scenario: Pino 日志自动进入 SigNoz

- **WHEN** Oceanus 后端启动，OTel SDK 初始化完成
- **THEN** 所有 Pino logger 产生的 `info/warn/error` 日志 SHALL 通过 OTLP HTTP 协议发送到 `http://otel-collector:4318`
- **AND** 日志数据在 SigNoz UI 的 Logs Explorer 中可见

#### Scenario: 日志与 Trace 自动关联

- **WHEN** 代码在一个活跃的 OpenTelemetry Span 上下文中调用 `logger.info(...)`
- **THEN** 发送到 SigNoz 的日志记录 SHALL 自动携带该 Span 的 `trace_id` 和 `span_id`
- **AND** 在 SigNoz UI 中可从日志跳转到对应的 Trace 详情

#### Scenario: 启动失败不影响业务

- **WHEN** OTel SDK 初始化失败（如 OTel Collector 不可达）
- **THEN** Oceanus 后端 SHALL 继续正常运行，不阻塞启动
- **AND** Pino logger SHALL 回退到标准 stdout 输出

### Requirement: OTel Collector 日志接收与转发

OTel Collector SHALL 接收 Oceanus 后端发送的 OTLP 日志数据，批量处理后转发到 SigNoz 的 ClickHouse 存储。

- 监听端口：gRPC `:4317`，HTTP `:4318`
- 使用 batch processor 合并日志记录以降低写入频率
- 配置 `retry_on_failure` 和 `sending_queue` 提升可靠性

#### Scenario: OTel Collector 正常接收日志

- **WHEN** Oceanus 后端通过 OTLP HTTP 向 `otel-collector:4318` 发送日志记录
- **THEN** OTel Collector SHALL 接收日志并写入 ClickHouse
- **AND** SigNoz UI 中 SHALL 实时展示日志数据

#### Scenario: OTel Collector 临时不可用

- **WHEN** OTel Collector 服务重启或短暂中断
- **THEN** Oceanus 后端的 OTel SDK SHALL 使用 sending_queue 缓存日志
- **AND** 恢复连接后 SHALL 自动重发缓存日志
