# DEPRECATED — 已被 SigNoz 替代。详见 openspec/changes/replace-signoz-grafana-loki-promtail/

# Spec: Log Infrastructure

## Purpose

日志基础设施能力（已废弃）：原基于 Grafana、Loki、Promtail 的容器日志采集、存储与查询方案，已被 SigNoz 自托管方案替代。

## Requirements

### Requirement: Docker Compose 集成日志服务

系统 SHALL 在 `docker-compose.yml` 中集成 Grafana、Loki、Promtail 三个服务，实现容器日志的自动采集、存储和查询。

#### Scenario: 启动日志栈

- **WHEN** 执行 `docker compose up -d`
- **THEN** Grafana 在端口 3002 可用
- **THEN** Loki 在端口 3100 可用
- **THEN** Promtail 自动启动并采集日志

#### Scenario: 服务健康检查

- **WHEN** 日志栈启动后
- **THEN** Grafana 数据源中已预配置 Loki 数据源
- **THEN** 可在 Grafana Explore 页面查询 `server` 容器的日志

#### Scenario: 日志栈停止

- **WHEN** 执行 `docker compose down`
- **THEN** 所有日志服务正常停止，不影响其他服务

### Requirement: Promtail 日志采集

Promtail SHALL 仅采集 `oceanus-server` 容器的 Docker 日志，推送至 Loki。

#### Scenario: 仅采集 server 容器

- **WHEN** Promtail 启动
- **THEN** 其配置 SHALL 仅匹配 `oceanus-server` 容器的 stdout/stderr
- **THEN** 其他容器（postgres、redis、clickhouse 等）的日志 SHALL 不被采集

#### Scenario: 日志标签

- **WHEN** Promtail 推送日志到 Loki
- **THEN** 每条日志 SHALL 携带 label: `container="oceanus-server"`, `service="server"`, `level`（Pino JSON 中提取）

### Requirement: Loki 日志存储

Loki SHALL 以本地文件系统存储日志数据，保留期 7 天。

#### Scenario: 日志保留

- **WHEN** 日志写入 Loki 超过 7 天
- **THEN** 超过 7 天的日志 SHALL 被自动删除或忽略

#### Scenario: 存储持久化

- **WHEN** Docker 服务重启
- **THEN** 已存储的日志数据 SHALL 不丢失（volume 挂载）

### Requirement: Grafana 预配置

Grafana SHALL 在启动时自动配置 Loki 数据源和基础仪表盘，无需手动操作。

#### Scenario: 数据源自动配置

- **WHEN** Grafana 首次启动
- **THEN** Loki 数据源 SHALL 已存在于数据源列表
- **THEN** 数据源 URL SHALL 指向 `http://loki:3100`

#### Scenario: 基础仪表盘

- **WHEN** 打开 Grafana 首页
- **THEN** SHALL 存在 Oceanus 基础日志仪表盘
- **THEN** 仪表盘 SHALL 支持按时间、日志级别、关键词筛选

### Requirement: 端口约定

日志服务 SHALL 使用以下端口，不与现有服务冲突。

#### Scenario: 端口检查

- **WHEN** 日志栈启动
- **THEN** Grafana SHALL 监听 3002（避免与 Langfuse 的 3001 冲突）
- **THEN** Loki SHALL 监听 3100
- **THEN** Promtail SHALL 监听 9080（metrics）
