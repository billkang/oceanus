# Brainstorming Session — Langfuse 接入 + 结构化日志

- **日期**：2026-07-23
- **参与者**：用户 + AI
- **主题**：Oceanus LLM 可观测性 & 应用日志体系建设

---

## 关键决策

1. **两件事并行**：Langfuse（LLM 可观测性）和结构化日志（应用日志）是独立的两条线，这次一起做
2. **日志框架选 Pino**（2026 年新项目推荐），配合 `nestjs-pino` 开箱即用
3. **不做历史数据回填** — 只记录接入后的新数据
4. **不替换现有 `FileSystemSessionStore`** — SDK 会话文件持久化保留
5. **不替代 NestJS Logger 的业务日志** — 现有日志保留，Pino 作为增强

## 需求要点

### Langfuse（LLM 可观测性）

| 需求 | 说明 |
|------|------|
| SDK 调用链追踪 | 每次 AI 响应中调了哪些工具、耗时、入参出参 |
| Token 消耗统计 | 每次请求的 input/output token 数 |
| 错误追踪 | SDK 调用失败、工具执行异常 |
| 用户交互分析 | 按用户/项目/会话查看对话模式 |
| 成本分析 | 按项目/时间段统计 API 费用 |

Langfuse 不需要自己的 LLM Key，只需 Public Key + Secret Key（从控制台生成），数据通过 OpenTelemetry 推送。

### 结构化日志（Pino）

| 需求 | 说明 |
|------|------|
| 日志框架 | Pino + `nestjs-pino` |
| 目录结构 | `logs/{project}/{session}.log`，按项目/会话分文件 |
| traceId | 每次 HTTP 请求自动生成 |
| 日志级别 | debug / info / warn / error |
| 控制台+文件 | 开发环境同时输出控制台和文件 |
| 扩展预留 | JSON 格式输出，未来可接 ELK / Loki |

## 边界范围

1. ✅ 只追踪 Claude Agent SDK 层（其他模块也跑在 SDK 里，无需单独追踪）
2. ✅ 不做自定义告警规则
3. ✅ 不替换现有 `FileSystemSessionStore` 
4. ✅ 不替代业务日志
5. ✅ 不做历史数据回填

## 环境策略

| 环境 | 日志 | Langfuse | 数据库 |
|------|------|----------|--------|
| dev | 控制台 + 文件 (debug) | docker-compose 自托管 | docker-compose |
| staging | 文件 (info) | 自托管 | 独立 PostgreSQL |
| prod | JSON → ELK/Loki | 自托管 (加 ClickHouse+Redis) | RDS |

## 后续步骤

1. Stage 3 — openspec SDD 文档（proposal → specs → design → tasks）
2. 实现接入
