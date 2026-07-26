# Brainstorming Session

- **日期**: 2026-07-26
- **参与者**: Bill Kang + Claude
- **主题**: 日志系统升级 — Grafana + Loki 集中式日志收集

## 需求背景

当前 Oceanus 后端（NestJS）使用 Pino 写入 `./logs/combined.log` 文件，开发和查询只能通过 `tail`/`grep` 手动操作。Docker 部署后多容器环境下查日志更麻烦。

目标：引入 Grafana + Loki 栈，实现集中式日志查询，不依赖任何云服务。

## 关键决策

| #   | 决策                               | 说明                                                                         |
| --- | ---------------------------------- | ---------------------------------------------------------------------------- |
| 1   | **保留 Pino**                      | Pino 产生的结构化 JSON 日志是 Loki 消费的基础，只改输出目标，不移除          |
| 2   | **输出目标改为 stdout**            | 生产环境 pino/file destination 从文件改为 stdout（fd 1），由 Docker 统一采集 |
| 3   | **新增 Grafana + Loki + Promtail** | 加到 docker-compose 中，Promtail 采集 Docker 容器日志推送 Loki               |
| 4   | **新增 `LOG_LEVEL` 环境变量**      | 取代硬编码的 NODE_ENV 级别切换，默认 `info`                                  |
| 5   | **去除文件日志**                   | 删除 `./logs/combined.log` 文件日志配置，清理 `server/logs/` 目录引用        |
| 6   | **最小化入侵**                     | 不改 SessionLogService、Langfuse、GlitchTip 等现有组件                       |

## 需求要点

### 功能需求

1. Grafana 界面可查询日志，支持按级别/服务/时间筛选
2. Loki 自动采集所有 Docker 容器 stdout 日志
3. Pino 输出 `info` 及以上级别的全量结构化日志到 stdout
4. 通过环境变量控制日志级别，开发环境可选 `debug`

### 边界范围（不做）

1. ❌ 不做全文搜索（Loki 标签索引，非全文）
2. ❌ 不做链路追踪（已有 Langfuse + Sentry）
3. ❌ 不做日志报警（第一版）
4. ❌ 不做长期归档（保留 7 天）
5. ❌ 不做前端日志收集
6. ❌ 不迁移 SessionLogService

## 技术要点

### 架构

```
Pino (NestJS) ──stdout──▶ Docker ──logs──▶ Promtail ──push──▶ Loki ──query──▶ Grafana
  ▲ LOG_LEVEL 控制级别
```

### 涉及文件

| 文件                                      | 改动                                       |
| ----------------------------------------- | ------------------------------------------ |
| `docker-compose.yml`                      | 新增 grafana、loki、promtail 三个 service  |
| `server/.env` / `.env.example`            | 新增 `LOG_LEVEL` 变量                      |
| `server/src/app.module.ts`                | Pino 配置改为参数化 level，移除文件 target |
| `server/src/main.ts`                      | 启动时输出 `LOG_LEVEL` 值                  |
| `.gitignore`                              | 确认 `*.log` / `logs/` 规则                |
| (新) `infra/loki/loki-config.yml`         | Loki 配置                                  |
| (新) `infra/promtail/promtail-config.yml` | Promtail 配置                              |

## 后续步骤

1. 更新 `.deepstorm/context.md`
2. 进入 SDD 流程：proposal → specs → design → tasks
3. 实现：docker-compose 配置 → Pino 配置改造 → 验证
4. 可选：清理 `server/logs/`、SessionLogService 后续评估

---

_此文件由 reef-start Path B 讨论产出，作为 SDD 流程输入。_
