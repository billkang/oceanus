## ADDED Requirements

### Requirement: SigNoz 自托管部署

系统 SHALL 在 docker-compose 中部署 SigNoz 单二进制版（2025 年新版架构），用于日志搜索和可视化。

- 使用官方 Docker 镜像 `signoz/signoz`
- 部署组件：
  - **SigNoz**（单二进制：UI + API + Alertmanager），端口 `8080`
  - **OTel Collector**（数据采集），端口 `4317`（gRPC）、`4318`（HTTP）
  - **ClickHouse**（可观测性数据存储），端口 `9000`（TCP）、`8123`（HTTP）
  - **ZooKeeper**（ClickHouse 协调），端口 `2181`
- ClickHouse 实例与 Oceanus 业务使用的 ClickHouse 完全独立，互不干扰
- 镜像标签使用固定版本，不使用 `latest`，确保可重现

#### Scenario: SigNoz 正常启动

- **WHEN** 执行 `docker compose up -d`
- **THEN** SigNoz 各项服务 SHALL 在 2 分钟内通过健康检查
- **AND** 访问 `http://localhost:8080` SHALL 展示 SigNoz UI 登录/首页

#### Scenario: SigNoz 接收日志并展示

- **WHEN** OTel Collector 将日志写入 ClickHouse
- **THEN** SigNoz UI 的 Logs Explorer SHALL 展示日志列表
- **AND** 支持按 `service.name`、`severity`（info/warn/error）、时间范围过滤日志

### Requirement: Grafana / Loki / Promtail 移除

系统 SHALL 从 docker-compose 中移除 Grafana、Loki、Promtail 三个 AGPL v3 组件，不再依赖其运行。

- 移除对应的 service 定义、数据卷挂载和 config 文件引用
- Loki 数据卷中的历史日志数据直接丢弃，不迁移

#### Scenario: 旧组件移除后 Oceanus 正常

- **WHEN** Grafana/Loki/Promtail 从 docker-compose 中移除，并执行 `docker compose down && docker compose up -d`
- **THEN** Oceanus 后端 SHALL 正常启动运行
- **AND** 日志数据 SHALL 仅通过 SigNoz 链路采集和展示

#### Scenario: 旧端口不再占用

- **WHEN** Grafana/Loki/Promtail 容器移除后
- **THEN** 原 Grafana `3002`、Loki `3100` 端口 SHALL 不再被占用
