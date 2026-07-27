---
status: accepted
date: 2026-07-23
deciders: billkang
---

# ADR-005: 前端技术栈

## 背景

Oceanus 需要一个企业级 SPA 用于 Web Portal 界面。候选方案包括 Angular SPA 和 Next.js。

## 决策

选择 **Angular + PrimeNG + Tailwind CSS**。

| 技术         | 版本             | 用途                   |
| ------------ | ---------------- | ---------------------- |
| Angular      | 21（Standalone） | 前端框架               |
| PrimeNG      | 21（Aura theme） | UI 组件库              |
| Tailwind CSS | 4                | CSS 工具类             |
| RxJS         | 7                | 响应式编程、SSE 流处理 |

### 为什么不是 Next.js

| 维度                  | 结论                                       |
| --------------------- | ------------------------------------------ |
| SSR/SEO               | 内部工具不需要                             |
| 交互密集型（聊天 UI） | Angular SPA 强项                           |
| 部署复杂度            | 静态文件 + Nginx，比 Next.js SSR 简单      |
| 团队技能匹配          | Java 团队 → Angular + PrimeNG 学习曲线更低 |

### 前端架构模式

- Standalone 组件（无 NgModule）
- OnPush 变更检测 + Signal 响应式状态管理
- inline template
- 函数式路由守卫（AuthGuard）
- 功能性 HTTP 拦截器

## 影响

- 前端独立于后端部署，静态文件通过 Nginx 分发
- 开发端口 4300，生产端口 80

## 相关

- [ADR-006: 后端框架选型](ADR-006-backend-stack.md)
