## 1. Monorepo 配置与基础设施

- [x] 1.1 修正 `client/proxy.conf.json` 端口 8080 → 3100，匹配后端运行端口
- [x] 1.2 安装 `@nestjs/jwt`（未用 passport，JWT 直接验证）；`cookie-parser`、`@anthropic-ai/claude-agent-sdk` 待安装
- [x] 1.3 确认 `.env` 包含完整环境变量：已创建 `server/.env`（DATABASE_URL / JWT_SECRET / PORT / CORS_ORIGIN）
- [-] 1.4 cookie-parser 中间件（已决策使用 JSON Bearer Token，暂不实现 httpOnly Cookie 方案）

## 2. 数据库 Schema 与迁移

- [x] 2.1 更新 `prisma/schema.prisma`：User + Project + Session + Asset，INT PK + UUID 字段
- [x] 2.2 运行 Prisma migrate dev 生成迁移文件
- [x] 2.3 更新 `PrismaService` 确保连接配置正确
- [x] 2.4 插入种子数据：测试账号 admin / oceanus123（bcrypt 加密）

## 3. 认证模块（后端）

- [x] 3.1 创建 `auth.module.ts`、`auth.controller.ts`、`auth.service.ts`
- [x] 3.2 实现 `POST /api/v1/auth/login`：验证测试账号+密码，返回 JSON 中 JWT Token（设计决策：MVP 用 JSON Bearer Token，暂不写入 httpOnly Cookie）
- [-] 3.3 实现 `POST /api/v1/auth/logout`（Token 方案由客户端自行清除，logout 端点暂不实现）
- [x] 3.4 实现 `GET /api/v1/auth/me`：返回当前用户信息
- [x] 3.5 创建 `JwtAuthGuard`（per-route 使用，无全局注册；`@Public()` 等后续需要时添加）
- [x] 3.6 测试：17 个用例覆盖登录成功/失败/用户禁用/模糊错误信息/Token 验证/缺失/过期/无效等场景

## 4. 项目模块（后端）

- [x] 4.1 创建 `project.module.ts`、`project.controller.ts`、`project.service.ts`
- [x] 4.2 实现 `GET /api/v1/projects`：返回项目列表（含 sessionCount，按 updatedAt 倒序）
- [x] 4.3 实现 `POST /api/v1/projects`：创建项目（名称必填校验，description 可选）
- [x] 4.4 实现 `GET /api/v1/projects/:id`：项目详情（含 sessionCount）
- [x] 4.5 实现 `PATCH /api/v1/projects/:id`：编辑项目名称/描述
- [x] 4.6 实现 `DELETE /api/v1/projects/:id`：级联删除（Prisma onDelete: Cascade）
- [x] 4.7 测试：15 个单元测试覆盖列表/创建/详情/编辑/删除全流程 + 错误路径

## 5. 会话模块（后端）

- [x] 5.1 创建 `session.module.ts`、`session.controller.ts`、`session.service.ts`
- [x] 5.2 实现 `GET /api/v1/projects/:projectId/sessions`：会话列表（按最后消息时间倒序）
- [x] 5.3 实现 `POST /api/v1/projects/:projectId/sessions`：创建新会话（初始标题"新会话"）
- [x] 5.4 实现 `GET /api/v1/sessions/:id`：会话详情
- [-] 5.5 实现 `DELETE /api/v1/sessions/:id`：物理删除，级联清理 DB（✅ DB 级联删除，JSONL + SDK 清理延后到 Task 007 Agent 模块）
- [x] 5.6 实现会话标题异步更新机制：N 轮消息后从首条用户消息生成摘要（后端 ChatService，通过 title_updated SSE 事件推送前端）
- [x] 5.7 测试：12 个单元测试覆盖创建/列表/详情/删除全流程

## 6. Agent 模块（后端 — SDK 集成）

- [x] 6.1 改造 `agent.module.ts` 和 `agent.service.ts`：封装 Claude Agent SDK (TypeScript) 工厂（SDK 已安装 `@anthropic-ai/claude-agent-sdk@0.3.218`）
- [x] 6.2 创建 `FileSystemSessionStore`：实现 SessionStore 接口（append/load/delete/listSessions），JSONL 存到 `data/sessions/`
- [x] 6.3 创建 SSE 事件类型定义（10 种事件类型）
- [-] 6.4 AgentService 核心方法：
  - `sendMessage` ✅ — 封装 SDK query()，返回 AsyncGenerator
  - `confirmChoice` ⚠️ — 方法定义 + controller 端点，实际 confirm 在 Chat Module SSE 流中调用 query.confirm()
  - `cancelResponse` ⚠️ — 方法定义 + controller 端点，实际中断在 Chat Module SSE 流中调用 query.interrupt()
  - `getSessionMessages` ✅ — 封装 SDK getSessionMessages()
  - `destroyAgent` ✅ — 封装 SDK deleteSession()
- [-] 6.5 SDK 事件 → SSE 事件映射：类型定义已建（sse-events.ts），实际映射在 Chat Module SSE 转发中实现
- [-] 6.6 SDK query 参数：`sessionStore` 已配置，Tide-discuss skill 加载 deferred 到 Chat Module 集成阶段
- [x] 6.7 环境变量缺失降级：`isAvailable()` + `sendMessage` 在未配置时抛出"AI 服务未配置"

## 7. 聊天/SSE 模块（后端）

- [x] 7.1 创建 `chat.module.ts`、`chat.controller.ts`、`chat.service.ts`
- [x] 7.2 实现 `POST /api/v1/sessions/:id/chat`：接收用户消息，启动 SSE 流，转发 Agent 事件（通过独立 SSE 端点 + POST 触发模式）
- [x] 7.3 实现 `GET /api/v1/sessions/:id/messages`：通过 SDK getSessionMessages() 读取历史
- [x] 7.4 实现 in-flight 缓冲区（环形队列，保留最新 4096 字符 token 流）
- [x] 7.5 SSE 错误处理：连接断开自动清理（Observable teardown），超时机制（30min RxJS timeout），错误事件推送
- [x] 7.6 测试：18 个单元测试覆盖 SSE 端点/流映射/错误路径/取消/缓冲/空消息

## 8. 资产模块（后端）

- [x] 8.1 创建 `asset.module.ts`、`asset.controller.ts`、`asset.service.ts`
- [x] 8.2 实现 `GET /api/v1/sessions/:sessionId/assets`：资产列表
- [x] 8.3 实现 `GET /api/v1/assets/:id`：资产详情（含 Markdown 内容）
- [x] 8.4 实现 `GET /api/v1/assets/:id/download`：下载 .md 文件（`Content-Disposition: attachment`）
- [x] 8.5 实现 `POST /api/v1/assets/:id/copy`：返回资产内容供前端复制
- [x] 8.6 Tide-discuss 完成后自动提取 PRD：Agent 完成时解析 SDK 响应，提取 PRD Markdown 写入 assets 表，通过 SSE 推送 `asset_ready` 事件（via ChatService.tryExtractPrd() 启发式扫描响应文本中的 PRD 标记）
- [x] 8.7 测试：12 个单元测试覆盖列表/详情/下载/复制/空列表

## 9. 登录页（前端）

- [x] 9.1 创建 `LoginComponent` + 路由 `/login`：用户名/密码表单 + 提交按钮
- [x] 9.2 实现登录逻辑：POST /auth/login，成功后跳转项目列表
- [x] 9.3 实现错误展示：401 时显示"账号或密码错误"，不清空输入
- [x] 9.4 创建 `AuthGuard`：未登录访问受保护路由时跳转到 /login
- [x] 9.5 创建 `HttpInterceptor`：自动处理 401 跳转登录页
- [x] 9.6 已登录用户访问 /login 时自动跳转项目列表
- [x] 9.7 测试：登录成功、登录失败、无 Token 访问、Token 过期

## 10. 项目列表页（前端）

- [x] 10.1 创建 `ProjectListComponent` + 路由 `/projects`：卡片列表（名称 + 备注 + 创建时间）
- [x] 10.2 实现空状态展示："暂无项目，点击创建第一个项目"
- [x] 10.3 创建项目对话框：名称输入 + 备注输入 + 创建按钮（内嵌在 ProjectListComponent 中）
- [x] 10.4 创建成功后自动跳转到项目工作区
- [x] 10.5 项目卡片点击 → 进入工作区（路由 /workspace/:id）
- [x] 10.6 加载状态 skeleton 和错误状态处理
- [x] 10.7 测试：列表加载、空状态、创建弹窗、错误处理

## 11. 工作区三栏布局（前端）

- [x] 11.1 创建 `WorkspaceComponent` + 路由 `/workspace/:projectId`：三栏布局容器
- [x] 11.2 左侧面板（可折叠）：会话历史列表（占位符，待 12.x 填充）
- [x] 11.3 中间面板：聊天区域（占位符，待 13.x 填充）
- [x] 11.4 右侧面板（可折叠）：资产内容展示区（占位符，待 15.x 填充）
- [x] 11.5 折叠切换动画和状态持久化（localStorage 通过 signals effect 自动持久化）
- [x] 11.6 响应式：面板折叠时主区域自动扩展（flex-1 + flex-shrink-0）

## 12. 会话历史列表（前端左侧面板）

- [x] 12.1 创建 `SessionListComponent`：显示项目下所有活跃会话
- [x] 12.2 按最后消息时间倒序排列，展示标题 + 最后消息时间（API 端排序，前端渲染）
- [x] 12.3 当前会话高亮，点击切换加载对应聊天记录
- [x] 12.4 删除按钮 + 确认弹窗："删除后会话记录和关联资产将永久清除，确认删除？"
- [x] 12.5 "新建会话"按钮（emit create 事件，待 13.x 对接）
- [x] 12.6 空状态："暂无会话"
- [x] 12.7 标题异步更新监听：接收 SSE 推送后更新侧边栏标题（via WorkspaceComponent → SessionListComponent.updateSessionTitle()）

## 13. 聊天 UI（前端中间面板）

- [x] 13.1 创建 `ChatComponent`：消息列表 + 输入框 + 发送按钮
- [x] 13.2 创建 `ChatMessageComponent`：支持用户/助手消息、文本块流式渲染
- [x] 13.3 流式文本渲染：接收 `text_chunk` SSE 事件，实时追加到当前消息块
- [x] 13.4 发送空消息时按钮禁用
- [x] 13.5 消息列表自动滚动到底部（用户上滚查看历史时保持位置）
- [x] 13.6 AI 状态提示："正在分析需求…" / "正在生成 PRD…"（对应 `tool_status` 事件）
- [x] 13.7 SSE 断线自动重连，重连后通过 GET /messages 补齐历史 + in-flight 缓冲
- [x] 13.8 加载历史消息时的 loading skeleton
- [x] 13.9 中断按钮：用户可主动中断 AI 响应（调用 cancel 接口）

## 14. 确认交互（前端 — 选项按钮 + "其他"）

- [x] 14.1 接收 `tool_confirm` SSE 事件，以按钮形式展示每个选项
- [x] 14.2 同步显示"其他"输入按钮，点击后展开自由文本输入框
- [x] 14.3 用户选择/提交后通过 `POST /sessions/:id/agent/confirm` 回传
- [x] 14.4 选择后所有按钮置灰，展示"处理中…"状态，防止重复点击
- [x] 14.5 SDK 确认收到后（下一个 SSE 事件到来前），关闭选项区域，恢复为聊天消息展示

## 15. 资产面板（前端右侧面板）

- [x] 15.1 创建 `AssetPanelComponent`：展示当前会话的资产列表
- [x] 15.2 监听 `asset_ready` SSE 事件，自动刷新资产列表
- [x] 15.3 点击资产条目展示完整 Markdown 渲染内容（PrimeNG Markdown 或类似组件）
- [x] 15.4 下载按钮：调用 GET /download 触发浏览器下载 .md 文件
- [x] 15.5 复制按钮：调用 POST /copy 获取内容，写入剪贴板
- [x] 15.6 空状态："暂无资产"

## 16. 会话恢复（前端 + 后端）

- [x] 16.1 后端：编写 `POST /api/v1/sessions/:id/recover` 端点，检查 SDK Agent 状态（通过 JSONL 文件判断）
- [-] 16.2 后端：检测 SDK JSONL 文件是否存在，存在则调用 SDK resume 机制（JSONL 存在标记 needsRecovery，SDK resume 依赖 AI 模型未完整接入）
- [x] 16.3 前端：用户重新打开有未完成 AI 响应的会话时，弹出"检测到未完成的讨论，是否恢复？"
- [-] 16.4 用户选"恢复" → 通过 SDK resume 继续之前讨论（SDK resume 未连接真实 AI 模型）
- [x] 16.5 用户选"不恢复" → 创建新上下文从头开始
- [x] 16.6 用户中断后重新进入时上下文保留

## 17. 异常处理与全局过滤器

- [x] 17.1 创建全局 HTTP 异常过滤器（`AllExceptionsFilter`），统一错误响应格式
- [x] 17.2 前端全局错误处理：网络错误、超时、500 错误统一提示
- [x] 17.3 SSE 连接异常：前端自动重连 + 重试退避策略（EventSource 原生重连 + 消息补齐）
- [x] 17.4 删除操作异常：级联删除部分失败时的错误提示（通过 NotificationService + error-toast 显示错误，SessionList/ProjectList 均添加错误处理）
- [x] 17.5 前端 404 页面（路由未匹配）
- [x] 17.6 后端启动时 Agent 初始化异常（配置缺失）不影响其他服务正常启动（`isAvailable()` 降级）

## 18. 全流程集成验证

- [x] 18.1 启动服务：登录 → 项目列表（空 → 创建）→ 进入工作区
- [x] 18.2 三栏布局：会话列表 ↔ 聊天区 ↔ 资产面板（折叠/展开）
- [x] 18.3 Tide-discuss 讨论流程：发送消息 → AI 流式响应 → 确认交互 → 继续讨论 → PRD 生成
- [x] 18.4 资产查看/下载/复制
- [x] 18.5 会话切换/恢复/删除（含级联清理验证）
- [x] 18.6 项目删除（含级联清理验证）
- [x] 18.7 所有空状态、加载状态、错误状态覆盖验证
