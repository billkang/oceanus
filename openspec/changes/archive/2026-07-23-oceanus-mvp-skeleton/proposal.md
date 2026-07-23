## Why

公司内部医疗 B 端 PM 的 PRD 质量参差不齐、需求边界模糊导致开发频繁返工。需要一个平台来标准化需求讨论流程，通过 BMAD 工作流引导 PM 从模糊想法收敛为结构化 PRD。

## What Changes

- **新平台 Oceanus MVP**：Angular 前端 + NestJS 后端，集成 Claude Agent SDK 驱动的 Tide-discuss 需求讨论工作流
- **混合存储架构**：消息由 SDK JSONL 管理，数据库仅存 users / projects / sessions / assets 四张映射表
- **国产模型接入**：通过 `ANTHROPIC_*` 环境变量覆盖，走 Kimi K2.6 等国产模型
- **简化认证**：写死测试账号，JWT Token，不做 SSO 集成
- **三栏交互布局**：会话历史（可折叠）｜聊天 + AI 驱动内容 ｜资产面板（可折叠）

## Capabilities

### New Capabilities

- `user-auth`: 测试账号登录 + JWT Token 鉴权
- `project-management`: 项目创建、列表查看、基本信息编辑
- `session-management`: 项目内会话创建、历史列表（时间倒序）、物理删除（级联清理 DB + JSONL）
- `chat-streaming`: 用户消息发送 + AI 响应 SSE 流式推送 + 历史消息通过 SDK getSessionMessages() 读取
- `agent-integration`: Claude Agent SDK (TypeScript) 封装，Tide-discuss Skill 加载，国产模型配置
- `asset-panel`: PRD 自动提取与展示，支持查看 / 下载 Markdown / 复制内容
- `confirmation-ui`: SDK 确认交互（选项按钮 + "其他"自由输入）
- `session-recovery`: 页面关闭后重新进入时提示恢复会话（SDK resume 机制）

### Modified Capabilities

<!-- 无 — 全新项目，不存在已有 spec -->

## Known Limitations

- **FileSystemSessionStore 单机绑定**：MVP 使用本地文件系统存 JSONL，水平扩展多实例部署时无法共享会话数据。有意推迟至 v2（升级为 PostgresSessionStore）
- **国产模型 API 兼容风险**：SDK 基于 Anthropic Messages API 设计，通过 `ANTHROPIC_BASE_URL` 指向 DeepSeek。若 DeepSeek 的 `/anthropic` 端点有微小格式差异，SDD 中无 fallback 机制。实现阶段需验证端到端兼容性
- **SSE + Nginx 生产部署**：SSE 长连接要求 Nginx 关闭 `proxy_buffering`。部署文档需明确标注此配置，遗漏将导致 SSE 流式推送异常
- **单用户测试账号**：用户凭据硬编码在代码中，未来增加用户或切换 SSO 时需要改代码。MVP 阶段刻意简化
- **级联删除未考虑批量性能**：删除项目时若有 100+ 会话，同步清理 JSONL 文件 + SDK Agent 实例可能超过请求超时。MVP 阶段可接受，未来需改为异步后台任务

## Impact

- **新项目**：全新 Angular + NestJS monorepo
- **数据库**：PostgreSQL 4 表 + Prisma ORM
- **外部依赖**：Claude Agent SDK (TypeScript) + 国产模型 API
- **实时通信**：SSE 端点需配置 Nginx `proxy_buffering off`
- **环境配置**：`.env` 文件管理 `ANTHROPIC_*` 四个环境变量
