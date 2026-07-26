# Design: Grafana + Loki 日志收集

## Context

当前 Oceanus 后端（NestJS）使用 `nestjs-pino` 的 Pino 日志系统，日志写入 `./logs/combined.log` 文件。开发环境查日志用 `tail`/`grep`，Docker 部署后多容器查询更麻烦。

项目已有 Langfuse（LLM 链路追踪）和 GlitchTip（错误追踪），但**应用日志**缺少集中查询能力。

### 现状架构

```
Pino (nestjs-pino)
  ├─ 开发: pino-pretty (stdout, level=debug)
  └─ 生产: pino/file → ./logs/combined.log (level=info)
           pino/file → stdout (level=warn)
  └─ SessionLogService: logs/{project}/{session}.log (独立文件)
```

### 约束

- 不上云，纯自托管 Docker Compose
- 不增加服务启动复杂度（`docker compose up -d` 原生拉起）
- 不改变现有 SessionLogService / Langfuse / GlitchTip
- Dockerfile 不包含 `.env`，环境变量通过 compose 传递

## Goals / Non-Goals

**Goals:**

- Grafana + Loki + Promtail 集成到 `docker-compose.yml`
- Pino 仅输出 stdout（不写文件），由 Docker 采集
- `LOG_LEVEL` 环境变量控制日志级别
- Grafana 启动时自动配置 Loki 数据源和基础仪表盘
- 日志保留 7 天

**Non-Goals:**

- 不替代 Langfuse（LLM 追踪）和 GlitchTip（错误追踪）
- 不做全文搜索（Loki 标签索引）
- 不做日志报警
- 不收集前端日志
- 不迁移 SessionLogService

## Decisions

### D1: 日志采集架构 — Promtail 混合模式（Docker Socket 服务发现 + 文件读取日志内容）

```
Pino ──stdout──▶ Docker ──json.log──▶ Promtail ──push──▶ Loki ──query──▶ Grafana
               收集容器 stdout    Socket 发现 + 文件读取     存储           查询
```

Promtail 采用 Promtail 标准混合模式：

1. **服务发现**：通过 `docker_sd_configs` 连接 Docker Socket（`/var/run/docker.sock`），自动发现容器元数据（名称、标签）。Socket 仅用于发现而非日志流传输。
2. **日志读取**：`docker` 流水线阶段从挂载的 `/var/lib/docker/containers` 目录读取 JSON 日志文件内容。
3. **过滤**：通过 `relabel_configs` 仅保留 `oceanus-server` 容器的日志。

**为什么不用纯 Docker Socket 或纯文件读取？**

- `docker_sd_configs` + 文件读取是 Promtail 官方推荐模式：Socket 负责动态发现容器（容器重启或滚动更新后自动重新发现），文件读取负责日志内容传输，两者分工明确
- 纯 Docker Socket 流式读取不具备日志轮转兼容性
- 纯文件读取需要固定容器日志路径，无法感知容器生命周期变化
- Docker Socket 挂载为只读（`:ro`），仅用于查询容器元数据，不暴露写权限

### D2: LOG_LEVEL 优先级

```
显式设置 LOG_LEVEL → 使用该值
未设置时:
  NODE_ENV=production  → 默认 info
  NODE_ENV=development → 默认 debug
```

Ps：不合法值时回退到 `info` 并输出警告

### D3: LOG_LEVEL 传递路径

| 环境        | 配置位置                       | 传递方式                |
| ----------- | ------------------------------ | ----------------------- |
| 本地开发    | `server/.env`                  | dotenv 运行时加载       |
| Docker 容器 | `server.environment.LOG_LEVEL` | docker-compose.yml 透传 |

注意：Dockerfile 不包含 `.env`，所以 Docker 环境必须通过 `docker-compose.yml` 的 environment 块传递 `LOG_LEVEL`。

### D4: Pino 配置改动

移除文件 target，参数化 level：

```typescript
// 改后
transport: {
  targets: [
    ...(process.env.NODE_ENV !== 'production'
      ? [{ target: 'pino-pretty', options: { ... }, level: LOG_LEVEL || 'debug' }]
      : [{ target: 'pino/file', options: { destination: 1 }, level: LOG_LEVEL || 'info' }]),
    // 移除文件 target — 不再写 ./logs/combined.log
  ],
}
```

### D5: Grafana 预配置文件结构

```
infra/
  grafana/
    provisioning/
      datasources/
        datasources.yml    # Loki 数据源定义（自动加载）
      dashboards/
        dashboard.yml       # 仪表盘加载器配置
        oceanus-logs.json  # 基础日志仪表盘定义
  loki/
    loki-config.yml         # Loki 配置（含保留期、存储路径）
  promtail/
    promtail-config.yml     # Promtail 配置（含容器过滤规则）
```

### D6: 端口分配

| 服务             |   端口   | 说明                         |
| ---------------- | :------: | ---------------------------- |
| Grafana          | **3002** | 避免与 Langfuse (3001) 冲突  |
| Loki             | **3100** | Promtail 推送 + Grafana 查询 |
| Promtail metrics | **9080** | 可选，仅内部暴露             |

### D7: Docker Compose 服务设计

```yaml
loki:
  image: grafana/loki:latest
  ports: ['3100:3100']
  volumes:
    - ./infra/loki:/etc/loki # 配置文件
    - loki_data:/loki # 日志数据存储
  command: -config.file=/etc/loki/loki-config.yml

promtail:
  image: grafana/promtail:latest
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers # 读取日志
    - ./infra/promtail:/etc/promtail # 配置
  command: -config.file=/etc/promtail/promtail-config.yml

grafana:
  image: grafana/grafana:latest
  ports: ['3002:3000']
  volumes:
    - ./infra/grafana/provisioning:/etc/grafana/provisioning # 预配置
    - grafana_data:/var/lib/grafana # 持久化
```

三个服务均为 `--profile app`，与 server/client/glitchtip 同一 profile，统一启动控制。

## Risks / Trade-offs

| 风险                                             | 缓解措施                                                  |
| ------------------------------------------------ | --------------------------------------------------------- |
| Loki 数据目录随时间增长                          | 7 天保留期配置，Loki 自动压缩和删除旧数据                 |
| `LOG_LEVEL` 不合法值                             | 回退到 `info` + 输出警告                                  |
| Promtail 依赖宿主机 `/var/lib/docker/containers` | macOS Docker Desktop 自动映射；Linux 需确保路径正确       |
| Pino 只输出 stdout 后本地开发无法持久日志        | 本地开发有 pino-pretty 终端输出已足够；Docker 部署有 Loki |
| Grafana provisioning 需要维护 JSON 仪表盘        | 基础仪表盘仅 3 面板，变更少                               |

## Migration Plan

1. 创建 `infra/` 配置文件目录（4 个配置 + 1 个 dashboard JSON）
2. 修改 `docker-compose.yml` 新增 3 个 service + 2 个 volume
3. 修改 `app.module.ts` Pino 配置（移除文件 target + LOG_LEVEL 参数化）
4. 新增 `server/.env` 和 `server/.env.example` 中 `LOG_LEVEL=info` 配置行
5. 修改 `docker-compose.yml` 中 `server.environment` 新增 `LOG_LEVEL`
6. 清理 `server/logs/` 目录（可选）
7. 验证：`docker compose --profile app up -d` → 访问 Grafana :3002 查日志

## File Change Summary

| 文件                                                      | 操作 | 说明                                                     |
| --------------------------------------------------------- | :--: | -------------------------------------------------------- |
| `docker-compose.yml`                                      | 修改 | 新增 loki、promtail、grafana 三服务 + 自定义网络/volumes |
| `infra/loki/loki-config.yml`                              | 新增 | Loki 服务配置（保留期、存储、schema）                    |
| `infra/promtail/promtail-config.yml`                      | 新增 | Promtail 配置（Docker 日志文件读取、标签处理）           |
| `infra/grafana/provisioning/datasources/datasources.yml`  | 新增 | Loki 数据源预配置                                        |
| `infra/grafana/provisioning/dashboards/dashboard.yml`     | 新增 | 仪表盘自动加载配置                                       |
| `infra/grafana/provisioning/dashboards/oceanus-logs.json` | 新增 | 基础日志仪表盘定义                                       |
| `server/src/app.module.ts`                                | 修改 | Pino 配置：移除文件 target，level 参数化                 |
| `server/.env`                                             | 修改 | 新增 `LOG_LEVEL` 配置行                                  |
| `server/.env.example`                                     | 修改 | 新增 `LOG_LEVEL` 示例                                    |
| `server/logs/combined.log`                                | 删除 | 不再需文件日志                                           |
