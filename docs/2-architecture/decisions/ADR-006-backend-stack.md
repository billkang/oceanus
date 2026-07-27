---
status: accepted
date: 2026-07-23
deciders: billkang
---

# ADR-006: 后端框架选型

## 背景

Oceanus 需要一个企业级 Node.js 后端框架，与 Claude Agent SDK 原生集成。

## 决策

选择 **NestJS**。

| 维度           | NestJS                             | Spring Boot           |
| -------------- | ---------------------------------- | --------------------- |
| 架构模式       | DI/模块/装饰器，与 Spring 高度相似 | 原生                  |
| Agent SDK 集成 | ✅ Claude SDK TS 可直接 npm import | ❌ 需 HTTP bridge     |
| SSE 流式穿透   | ✅ 同进程 RxJS，零开销             | ⚠️ WebFlux 增加复杂度 |
| MVP 迭代速度   | ✅ 热重载，快速原型                | ⚠️ 编译+启动慢        |

关键洞察：团队 Java 背景是选择 NestJS 的**加分项**——NestJS 借鉴了 Spring 的 DI/模块/装饰器模式，让 Java 团队以最低学习成本接入 Node.js 生态。

## 相关

- [ADR-005: 前端技术栈](ADR-005-frontend-stack.md)
