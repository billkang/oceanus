# Proposal: Grafana + Loki 日志集中收集

## Why

当前 Oceanus 后端（NestJS）的 Pino 日志写入本地 `./logs/combined.log` 文件，多容器部署下查询日志需要 SSH 登录每台机器手动 `tail`/`grep`，效率低且不满足可观测性需求。引入 Grafana + Loki 栈后，所有容器日志由 Promtail 自动采集推送 Loki，通过 Grafana 统一查询和可视化，不依赖任何云服务。

## What Changes

1. **新增 Grafana + Loki + Promtail 服务**到 `docker-compose.yml`
2. **修改 Pino 配置**：生产环境日志输出从文件改为 stdout，移除 `pino/file` 文件目标
3. **新增 `LOG_LEVEL` 环境变量**：取代硬编码的 `NODE_ENV` 级别切换，默认 `info`
4. **移除文件日志**：删除 `./logs/combined.log` 相关配置
5. **保留 SessionLogService、Langfuse、GlitchTip** 等现有组件不变

## Capabilities

### New Capabilities

- `log-infrastructure`: Grafana + Loki + Promtail 三个 Docker 服务的配置、持久化、网络接入
- `log-level-config`: 通过 `LOG_LEVEL` 环境变量控制 Pino 日志输出级别，默认 `info`

### Modified Capabilities

（无，本项目无已有 spec）

## 不做什么 (Out of Scope)

1. **不做全文搜索** — Loki 基于标签索引，非全文搜索引擎。全文搜索需求应使用 Elasticsearch（当前无此需求）
2. **不做链路追踪** — 已有 Langfuse（LLM 调用链）和 GlitchTip（错误追踪），三者职责分离 | Permanent
3. **不做日志报警** — 第一版不引入 AlertManager | v2 考虑
4. **不做长期归档** — 日志保留 7 天后自动删除，不冷备 | Permanent（后续按需调整）
5. **不收集前端日志** — 仅后端 server 日志 | Permanent
6. **不迁移 SessionLogService** — 会话级日志保持独立文件 | v2 评估
7. **不增加 Grafana 用户认证** — Grafana 默认匿名访问（内网环境）| v2 考虑加反向代理认证
8. **不提升 Docker Compose 启动依赖** — 日志服务异常不该阻止 server/client 启动 | Permanent

## Impact

| 影响面          | 说明                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------- |
| **Docker 编排** | `docker-compose.yml` 新增 3 个 service；需新增 `infra/loki/` 和 `infra/promtail/` 配置文件    |
| **后端配置**    | `server/src/app.module.ts` 修改 Pino transport 配置；`server/src/main.ts` 可输出 LOG_LEVEL 值 |
| **环境变量**    | `server/.env` / `.env.example` 新增 `LOG_LEVEL`                                               |
| **存储**        | Promtail 采集日志占本地磁盘（按 7 天保留期）；Loki 数据需配置 volume                          |
| **端口**        | Grafana 3002、Loki 3100、Promtail 9080（relabel 时可选）                                      |
| **成本**        | 纯自托管，零云成本；额外 ~200MB 内存（Grafana + Loki + Promtail）                             |
| **操作**        | 启动方式不变，`docker compose up -d` 自动拉起新服务                                           |

## Known Limitations

- **`LOG_LEVEL` 不可热更新**：修改 `.env` 后必须重启容器才能生效，不支持运行时动态调级。如需热更新，后续可引入信令触发或 API。
- **Promtail 宿主机路径兼容性**：macOS Docker Desktop 和 Linux 的 `/var/lib/docker/containers` 路径可能不同。建议 docker-compose.yml 中用变量或 profile 区分。如果 Promtail 容器启动后日志文件路径不匹配，采集静默失败，排查时可能误以为日志丢失。
- **本地开发仅终端输出**：Pino 移除文件日志后，本地开发完全依赖 `pino-pretty` 控制台输出。终端关闭后日志即丢失。如需持久化可保留文件 target 并用 `LOG_LEVEL` 控制（目前设计不保留）。
- **Grafana 无认证**：内网环境下 Grafana 监听 3002 端口且无登录要求，同一宿主机其他容器可通过内部网络访问。
- **Loki 单点无高可用**：单实例 Loki 故障时 Grafana 日志查询不可用，但不影响应用服务运行。
