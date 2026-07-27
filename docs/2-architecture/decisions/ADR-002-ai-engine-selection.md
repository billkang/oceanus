---
status: accepted
date: 2026-07-23
deciders: billkang
---

# ADR-002: AI 引擎选型

## 背景

Oceanus 需要一个 AI Agent 引擎来驱动多轮对话和 Skill 执行。候选方案包括 Claude Agent SDK、LangGraph 和 Pi Agent Harness。

## 决策

选择 **Claude Agent SDK（TypeScript）**。

| 维度            | Claude Agent SDK          | LangGraph         | Pi Agent        |
| --------------- | ------------------------- | ----------------- | --------------- |
| Skills 机制     | ✅ 原生 SKILL.md 文件系统 | ❌ 需自行抽象     | ❌ 生态不同     |
| DeepStorm 兼容  | ✅ 零成本对接             | ❌                | ⚠️ 改造成本高   |
| 自定义 Provider | ✅ 支持 DeepSeek 等       | ✅                | ❌ 仅 Anthropic |
| 流事件 / SSE    | ✅ 原生支持               | ⚠️ callback       | ❌              |
| OTel 可观测性   | ✅ 官方 Langfuse 集成     | ✅ LangChain 生态 | ❌              |

## 影响

- NestJS 后端可直接 npm import SDK，无需额外 HTTP bridge
- SDK 负责 tool_use 循环，Oceanus 通过 stream_event 监听而不控制
- 模型可通过 `ANTHROPIC_*` 环境变量切换为国产模型

## 相关

- [ADR-009: Skills 注册机制](ADR-009-skills-registration.md)
