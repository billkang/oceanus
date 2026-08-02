# 架构决策记录（ADR）

> 每个 ADR 文件记录一次重要的技术决策，包括背景、备选方案和权衡。

## 索引

| 编号                                                  | 标题                   | 日期       | 领域      |
| ----------------------------------------------------- | ---------------------- | ---------- | --------- |
| [ADR-001](ADR-001-message-storage.md)                 | 消息存储与数据库策略 ⚠️ 被 ADR-014 取代 | 2026-07-23 | 数据层    |
| [ADR-002](ADR-002-ai-engine-selection.md)             | AI 引擎选型            | 2026-07-23 | AI        |
| [ADR-003](ADR-003-concurrency-architecture.md)        | 并发控制架构           | 2026-07-26 | 架构      |
| [ADR-004](ADR-004-observability-logging.md)           | 可观测性与日志方案     | 2026-07-26 | 运维      |
| [ADR-011](ADR-011-observability-signoz.md)            | SigNoz 日志方案        | 2026-07-28 | 运维      |
| [ADR-005](ADR-005-frontend-stack.md)                  | 前端技术栈             | 2026-07-23 | 前端      |
| [ADR-006](ADR-006-backend-stack.md)                   | 后端框架选型           | 2026-07-23 | 后端      |
| [ADR-007](ADR-007-authentication-mvp.md)              | MVP 认证策略           | 2026-07-23 | 安全      |
| [ADR-008](ADR-008-session-continuity.md)              | 会话连续性与 UI 保护   | 2026-07-24 | 前端/后端 |
| [ADR-009](ADR-009-skills-registration.md)             | Skills 注册机制        | 2026-07-23 | AI        |
| [ADR-010](ADR-010-infrastructure-containerization.md) | 工程基础设施与容器化   | 2026-07-25 | 运维      |
| [ADR-012](ADR-012-turn-budget-limits.md)              | 轮次与预算上限管控     | 2026-08-01 | AI        |
| [ADR-013](ADR-013-multi-model-runtime-switching.md)   | 多模型注册与运行时切换 | 2026-08-01 | AI        |
| [ADR-014](ADR-014-session-partitioning.md)            | 会话消息落库 SessionEntry + 分区隔离 | 2026-08-02 | 数据层    |

---

> **新增决策流程：** 新建 `ADR-NNN-title.md` 文件，写入背景、决策、影响、备选方案，然后在索引中添加条目。
