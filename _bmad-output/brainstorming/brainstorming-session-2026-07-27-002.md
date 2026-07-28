# Brainstorming Session

- **日期**: 2026-07-27
- **Change**: `replace-signoz-grafana-loki-promtail`
- **状态**: ✅ 讨论完成

---

## 讨论主题

用 SigNoz 替代 Grafana + Loki + Promtail，消除 AGPL v3 商业许可风险。

## 关键决策

| #   | 决策                                                                                                                | 理由                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | 用 **SigNoz**（Apache 2.0）替换 Grafana/Loki/Promtail（AGPL v3）                                                    | 消除商业许可风险，统一可观测性平台                                                |
| 2   | **保留 Langfuse**，不做合并                                                                                         | Langfuse 专注 LLM 专属观测（token 统计、prompt 管理、评估），与 SigNoz 定位不重叠 |
| 3   | 日志链路从 `Pino → stdout → Promtail → Loki → Grafana` 改为 `Pino → OTel instrumentation → OTel Collector → SigNoz` | OTel 原生协议，自动关联 trace_id，无需文件 tail                                   |
| 4   | 不改现有 Pino logger 调用                                                                                           | 通过 `@opentelemetry/instrumentation-pino` 零侵入接入                             |
| 5   | Langfuse 保留做 LLM 专属观测                                                                                        | LLM 评估/评测、prompt 版本管理、token 用量统计非 SigNoz 方向                      |

## 需求要点

1. 部署 SigNoz（含 OTel Collector、ClickHouse、ZooKeeper）
2. 在 Oceanus 后端接入 OTel Pino instrumentation，将日志导出到 OTel Collector
3. 从 docker-compose 中移除 Grafana、Loki、Promtail 容器
4. 更新架构文档（overview.md、端口表、基础设施说明）

## 边界范围（不做的）

- ❌ 不替换 Langfuse
- ❌ 不改动现有的 Pino logger 调用代码
- ❌ 不引入除 SigNoz 之外的新可观测性平台
- ❌ 第一阶段不做告警规则迁移
- ❌ 不处理历史日志迁移（Loki 中的数据可留存后手动清理）

## 后续步骤

1. → **阶段三**：SDD 文档生成（proposal → specs → design → tasks）
2. → spec-hardener 审查
3. → 实现计划
4. → 实现
