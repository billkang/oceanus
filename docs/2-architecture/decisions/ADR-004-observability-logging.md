---
status: superseded
date: 2026-07-26
superseded-by: ADR-011
superseded-date: 2026-07-28
deciders: billkang
---

# ADR-004: 链追踪方案（Langfuse）

> 日志部分已由 [ADR-011](ADR-011-observability-signoz.md) 接管。

## 背景

Oceanus 需要 LLM 调用追踪能力，不上云、自托管。

## 决策

### 链追踪：Langfuse

- 自托管 Docker，消费 SDK OTel 数据（OpenInference 格式）
- 记录 tool_use 调用链、Token 消耗、响应延迟
- 不需要 LLM Key——Langfuse 只消费 OTel 数据，不调模型
- SDK 零侵入集成，`LANGFUSE_BASE_URL` 未配置时自动静默

## 影响

- `LANGFUSE_*` 环境变量控制 Langfuse 连接
- SessionLogService 保持独立，不受影响
