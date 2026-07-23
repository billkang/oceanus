# Brainstorming Session — Oceanus MVP

> 日期: 2026-07-23 | 前置讨论: tide-20260722-001 (OCEANUS-AI-PLATFORM-V1) + tide-20260723-001 (HYBRID-SESSION-ARCH)

## 讨论主题

面向内部 PM 的 AI 中台 MVP，通过 BMAD 工作流标准化需求讨论流程（想法诊断 → PRD 生成 → 方案对比）。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| D-1 | 面向内部 PM（≤10人），不做外部客户 | 定位公司内部工具 |
| D-2 | 前端 Angular + PrimeNG + Tailwind | 团队技术栈，PrimeNG 默认风格 |
| D-3 | 后端 NestJS (TypeScript) | Claude Agent SDK 原生 TS 集成 |
| D-4 | Claude Agent SDK TS 版，锁版本 | 国产模型兼容（新版 tool-calling API 改版） |
| D-5 | 走国产模型（Kimi K2.6 等），不走 Claude | 成本控制，通过 `ANTHROPIC_*` env 覆盖 |
| D-6 | 数据库仅 4 张表（users/projects/sessions/assets） | 消息由 SDK JSONL 管理，sessions 仅存映射 |
| D-7 | 会话归档取消，改为物理删除 | 级联清理 DB + JSONL |
| D-8 | 三栏布局（会话历史 / 聊天 / 资产面板），均可折叠 | 简洁 MVP 设计 |
| D-9 | 不做 Agent/Skill 市场页，直接集成 Tide-discuss | 聚焦核心流程 |
| D-10 | 不做 LDAP/OIDC SSO，写死测试账号 | 降低 MVP 复杂度 |

## 需求要点

- 登录页 → 项目列表 → 创建项目（名称+备注）→ 自动进入项目
- 项目内自动创建新会话，自动启动 Tide-discuss
- 聊天内容由 Claude Agent SDK 驱动，通过 SSE 流式推送
- AI 运行中文字状态提示（无进度条）
- SDK 需要确认时展示选项按钮 + "其他"自由输入
- 讨论完成 → PRD 自动提取到资产面板（支持查看/下载/复制）
- 会话历史按时间倒序，支持删除（级联清理）
- 中断/异常/恢复机制

## 边界范围（明确不做的）

1. 不做 Agent/Skill 市场页
2. 不做量化指标追踪
3. 不做外部客户/多租户
4. 不做 LDAP/OIDC/SSO 真实认证
5. 不做方案对比功能（后续版本）
6. 不做知识库推送（无可用服务）
7. 不做 Jira 工单自动创建（无可用服务）
8. 不做定制化 UI 设计（PrimeNG 默认风格）
9. 不做消息数据库持久化（SDK JSONL 管理）

## 后续步骤

1. **openspec SDD 文档生成** — proposal → specs → design → tasks
2. **Spec hardening** — 过五道筛
3. **实现计划** — writing-plans 拆解为文件级步骤
4. **TDD 实现** — 逐 task 推进

## 参考文档

- [Oceanus MVP PRD](../../tide-data/prds/oceanus-mvp-prd.md)
- [Tide Task 清单](../../tide-data/tasks/)
