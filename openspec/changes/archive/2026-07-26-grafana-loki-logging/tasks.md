# Tasks: Grafana + Loki 日志收集

## 1. 基础设施配置文件

- [x] 1.1 创建 `infra/loki/loki-config.yml`（保留期 7 天、本地存储路径）
- [x] 1.2 创建 `infra/promtail/promtail-config.yml`（Docker 日志文件读取、仅匹配 `oceanus-server` 容器）
- [x] 1.3 创建 `infra/grafana/provisioning/datasources/datasources.yml`（Loki 数据源）
- [x] 1.4 创建 `infra/grafana/provisioning/dashboards/dashboard.yml`（仪表盘自动加载配置）
- [x] 1.5 创建 `infra/grafana/provisioning/dashboards/oceanus-logs.json`（基础日志仪表盘）

## 2. Docker Compose 编排

- [x] 2.1 `docker-compose.yml` 新增 loki 服务（配置挂载 + 数据卷 + 端口）
- [x] 2.2 `docker-compose.yml` 新增 promtail 服务（配置挂载 + 日志目录挂载）
- [x] 2.3 `docker-compose.yml` 新增 grafana 服务（预配置挂载 + 数据卷 + 端口）
- [x] 2.4 `docker-compose.yml` 新增 `loki_data` 和 `grafana_data` volume 声明

## 3. Pino 配置改造

- [x] 3.1 修改 `server/src/app.module.ts`：移除 `pino/file` 文件 target（`./logs/combined.log`）
- [x] 3.2 修改 `server/src/app.module.ts`：Pino level 改为参数化，读取 `LOG_LEVEL` 环境变量，按 NODE_ENV 区分默认值
- [x] 3.3 修改 `docker-compose.yml` 中 `server.environment` 新增 `LOG_LEVEL` 传递
- [x] 3.4 `server/.env` 和 `server/.env.example` 新增 `LOG_LEVEL=info` 配置行

## 4. 清理与验证

- [x] 4.1 删除 `server/logs/combined.log`（不再需要的文件日志）
- [x] 4.2 验证本地启动：`pnpm --filter @oceanus/server start:dev` 日志正常输出
- [x] 4.3 验证 Docker 部署：`docker compose --profile app up -d` → Grafana :3002 可查 server 日志
