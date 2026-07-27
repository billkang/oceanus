---
status: accepted
date: 2026-07-23
deciders: billkang
---

# ADR-009: Skills 注册机制

## 背景

Oceanus 需要注册和管理 DeepStorm Skill 的方式。

## 决策

SDK Skills 通过 SDK Skills API（文件系统驱动）注册，**不包装为 MCP Tool**。

| 维度           | SDK Skills（选型）                       | MCP Tool 包装（不采用）   |
| -------------- | ---------------------------------------- | ------------------------- |
| 注册方式       | SKILL.md 放入 `.claude/skills/` 自动注册 | 手写 tool() + schema 定义 |
| 工作流支持     | ✅ 原生（多角色讨论等复杂指令）          | ❌ 原子函数调用           |
| DeepStorm 兼容 | ✅ 零改造成本                            | ❌ 需大量改造             |
| 运行时决策     | ✅ SDK 自主选择 Skill 调用               | ❌ 需 Oceanus 前置编排    |

### Skill 与 Tool 的分工

| 概念           | 作用                | 示例                                |
| -------------- | ------------------- | ----------------------------------- |
| **SDK Skills** | 行为指令 / 工作流   | tide-discuss（需求讨论 5 角色流程） |
| **MCP Tools**  | 原子操作 / 外部服务 | Jira Create Issue、Feishu Wiki      |
| **Bash Tools** | 文件系统操作        | 读写 tide-data/ 目录                |

## 影响

- Skill 的 SKILL.md 中声明所需 MCP 能力，运行时由 SDK 按需连接对应 MCP Server
- Oceanus 创建项目时运行 `deepstorm setup` 或预置所有内置 Skill 文件

## 相关

- [ADR-002: AI 引擎选型](ADR-002-ai-engine-selection.md)
