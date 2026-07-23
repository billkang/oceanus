## Context

**Oceanus MVP** 是一个面向内部医疗 B 端 PM 的需求讨论平台，通过 BMAD 工作流（Tide-discuss）将模糊需求收敛为结构化 PRD。

### 当前状态

- **Monorepo 脚手架**已搭建：pnpm workspaces（`server/` + `client/`）
- **后端**（server/）：NestJS 11 + Prisma 6 + PostgreSQL，已有 User 模型、PrismaModule、AgentModule 骨架
- **前端**（client/）：Angular 21 + PrimeNG 21 + Tailwind，已有路由、AppComponent 骨架
- **API 前缀**：`/api/v1`，端口 3100
- **Claude Agent SDK**：`@anthropic-ai/sdk` ^0.40.0 已安装（注意：此为 Anthropic SDK，Claude Agent SDK 需要额外安装 `@anthropic-ai/claude-agent-sdk`）
- **Tide-discuss Skill**：已安装为项目级 skill（`.claude/skills/tide-discuss/SKILL.md`）
- **代理配置**：`/api` → `localhost:8080`（需改为 `localhost:3100` 匹配后端端口）
- **JWT/cookie 中间件**：尚未安装

### 约束

- 国产模型替代 Claude：通过 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` 配置
- 测试账号：admin / oceanus123（硬编码）
- 无 SSO、无 OAuth、无 refresh token
- 单用户 MVP（不涉及多租户隔离）

## Goals / Non-Goals

**Goals:**

- 实现测试账号登录 + JWT httpOnly Cookie 鉴权
- 项目 CRUD + 列表（含空状态）
- 项目内三栏布局：会话历史（可折叠）| 聊天 + AI 内容 | 资产面板（可折叠）
- Claude Agent SDK 集成，加载 Tide-discuss Skill
- AI 响应 SSE 流式推送
- SDK 确认交互（选项按钮 + "其他"自由输入）
- PRD 自动提取与展示（查看/下载/复制）
- 物理删除项目/会话（级联清理 DB + JSONL + SDK 实例），含确认弹窗
- 会话恢复（断线重连 + in-flight 缓冲区 + SDK resume）
- 为空状态、加载状态、错误状态覆盖所有视图

**Non-Goals:**

- 用户注册/密码找回/OAuth/SSO — 硬编码测试账号
- 多租户、RBAC 权限模型 — 单用户
- 消息持久化到数据库 — 由 SDK JSONL 管理
- 知识库推送（4a）和 Jira 任务拆分（4b/4c）— Tide-discuss 流程中的后置步骤，MVP 暂不实现
- 实时多人协作
- WebSocket 替代 SSE
- 会话归档 — 仅支持物理删除
- 移动端适配
- 国际化（i18n）

## Decisions

### D1：后端架构模式

| 选项 | 结论 |
|------|------|
| 模块化 NestJS（auth / project / session / chat / agent / asset 各独立 module） | **采纳**。符合 NestJS 最佳实践，每个 module 包含 controller + service，与 spec 一一对应 |

### D2：会话存储 — SessionStore Adapter（自定义路径）

SDK 默认将 JSONL 存在 `~/.claude/projects/` 下。为将数据控制在项目内，实现自定义 `FileSystemSessionStore`，将 JSONL 存入 `data/sessions/{session-uuid}.jsonl`。

- 实现 `SessionStore` interface（`append` / `load` / `delete`）
- 项目根目录下的 `data/sessions/` 目录
- 删除会话时同步删除对应 JSONL 文件

### D3：SDK Skill 加载 — 项目级原生

SDK 原生支持从 `.claude/skills/` 加载 skill：

```typescript
query({
  prompt: "开始 Tide-discuss 需求讨论",
  options: {
    settingSources: ["user", "project"],
    skills: "all",                    // 自动发现 tide-discuss skill
    sessionStore: fileSystemStore,
    sessionId: session.uuid,
  }
})
```

Tide-discuss 的 BMAD 流程（多角色讨论 + checklist）由 skill 在 LLM 内部自主驱动，后端只负责 SSE 事件转发。

### D4：鉴权方案 — httpOnly Cookie

| 决定 | 理由 |
|------|------|
| JWT 存在 httpOnly Cookie 中 | 自动携带、XSS 防护、无需前端处理 token 刷新 |
| 无 refresh token | MVP 阶段简化，过期后重新登录 |

### D5：SSE 事件协议统一

8 个标准化事件由后端 `AgentService` 统一发射，前端 `switch(event.type)` 统一消费：

| 事件名 | 来源 |
|--------|------|
| `text_chunk` | SDK content_block_delta |
| `tool_start` | SDK tool_use 开始 |
| `tool_status` | SDK tool_use 进行中 |
| `tool_confirm` | SDK 需要用户确认 |
| `confirm_result` | 前端回传用户选择 |
| `asset_ready` | PRD 资产就绪 |
| `error` | 错误事件 |
| `done` | AI 响应完成 |

### D6：断线重连 — in-flight 缓冲区

后端维护内存环形队列，重连时先回放缓冲区内容，再通过 `getSessionMessages()` 补齐 SDK 已持久化的历史。

缓冲区容量策略：保留最新 4096 字符（约 2-3 轮 SSE `text_chunk` 消息量）。**理由：** SSE 断线通常发生在毫秒级网络抖动，此容量足以覆盖重连间隙。超出部分截断早期 token，核心历史由 JSONL 文件保证完整。该值可通过环境变量 `IN_FLIGHT_BUFFER_SIZE` 覆盖。

### D7：会话标题 — 异步 LLM 摘要

- 初始标题："新会话"
- 触发时机：多轮消息后（默认 N=3 轮，可配置 `DEFAULT_TITLE_ROUNDS`）
- 调用小模型（`ANTHROPIC_SMALL_FAST_MODEL`）异步生成摘要
- 写入 DB 后通过 SSE 推送更新到侧边栏

### D8：删除策略 — 物理级联删除

项目/会话删除时：
1. 前端展示确认弹窗（明确说明不可恢复）
2. 后端删除 DB 记录
3. 删除对应 JSONL 文件
4. 销毁 SDK Agent 实例（释放内存资源）

### D9：文件系统 SessionStore

```typescript
// server/src/agent/stores/file-system.store.ts
interface FileSystemStoreOptions {
  basePath: string; // data/sessions/
}
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client (Angular 21)               │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────┐  │
│  │ 左侧面板  │  │  中间聊天区      │  │ 资产面板 │  │
│  │ (可折叠)  │  │  AI 流式渲染     │  │ (可折叠)  │  │
│  │ 会话列表  │  │  选项按钮交互    │  │ PRD 展示  │  │
│  └──────────┘  └──────────────────┘  └──────────┘  │
│                                                    │
│  EventSource ← SSE (单向) | POST (用户操作)        │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                  Server (NestJS 11)                  │
│                                                      │
│  AuthModule → JWT + httpOnly Cookie 验证             │
│  ProjectModule → CRUD + 级联删除                     │
│  SessionModule → 创建/列表/删除 + JSONL 管理          │
│  ChatModule → SSE 端点 + in-flight 缓冲区             │
│  AgentModule → SDK 封装 + FileSystemStore + 事件转发  │
│  AssetModule → PRD 资产 CRUD                          │
│                                                      │
│  ┌────────────────────────────────────┐              │
│  │  Claude Agent SDK (TypeScript)     │              │
│  │  ├─ settingSources: ["project"]    │              │
│  │  ├─ skills: "all" → tide-discuss  │              │
│  │  ├─ sessionStore: FileSystemStore  │              │
│  │  └─ model: deepseek-v4-flash      │              │
│  └────────────────────────────────────┘              │
│                                                      │
│  FileSystemSessionStore → data/sessions/{uuid}.jsonl │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────┐
│                 PostgreSQL                           │
│  users | projects | sessions | assets                │
│  (仅元数据，消息在 JSONL)                             │
└─────────────────────────────────────────────────────┘
```

## Change Scope Matrix

| 模块 | 后端 | 前端 | 数据层 |
|------|------|------|--------|
| Auth | `AuthModule` + `@nestjs/jwt` + `cookie-parser` | 登录页组件 | +User 表（已有）|
| Project | `ProjectModule` + ProjectController + ProjectService | 项目列表页 + 创建弹窗 | +Project 表 |
| Session | `SessionModule` + SessionController + SessionService | 左侧面板 + 确认弹窗 | +Session 表 |
| Chat | `ChatModule` + SSE 端点 + in-flight 缓冲区 | 聊天区 + 流式渲染 | 无（SDK JSONL） |
| Agent | `AgentModule` 改造 + `FileSystemSessionStore` + 事件转发 | 无 | 无（SDK 管理） |
| Asset | `AssetModule` + AssetController + AssetService | 右侧面板 | +Asset 表 |
| Config | .env 配置 + CLAUDE.md 更新 + proxy.conf.json 修正 | — | — |

### 新增文件

```
server/src/
├── auth/
│   ├── auth.module.ts
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   └── guard/
│       ├── jwt-auth.guard.ts
│       └── public.decorator.ts
├── project/
│   ├── project.module.ts
│   ├── project.controller.ts
│   ├── project.service.ts
│   └── dto/
│       ├── create-project.dto.ts
│       └── update-project.dto.ts
├── session/
│   ├── session.module.ts
│   ├── session.controller.ts
│   ├── session.service.ts
│   └── dto/
│       └── create-session.dto.ts
├── chat/
│   ├── chat.module.ts
│   ├── chat.controller.ts
│   └── chat.service.ts
├── asset/
│   ├── asset.module.ts
│   ├── asset.controller.ts
│   ├── asset.service.ts
│   └── dto/
│       └── create-asset.dto.ts
├── agent/
│   ├── agent.module.ts (改造)
│   ├── agent.service.ts (改造)
│   ├── agent.provider.ts (SDK 工厂)
│   └── stores/
│       └── file-system.store.ts ← NEW
│   └── types/
│       └── sse-events.ts ← NEW (SSE 事件类型定义)
└── common/
    └── filters/
        └── http-exception.filter.ts

client/src/app/
├── auth/
│   ├── login.component.ts
│   └── login.component.html
├── project/
│   ├── project-list.component.ts
│   ├── project-list.component.html
│   ├── project-create-dialog.component.ts
│   └── project-create-dialog.component.html
├── workspace/
│   ├── workspace.component.ts
│   ├── workspace.component.html     ← 三栏布局容器
│   ├── session-list/
│   │   ├── session-list.component.ts
│   │   └── session-list.component.html
│   ├── chat/
│   │   ├── chat.component.ts
│   │   ├── chat.component.html
│   │   ├── chat-message.component.ts
│   │   └── chat-message.component.html
│   └── asset-panel/
│       ├── asset-panel.component.ts
│       └── asset-panel.component.html
├── shared/
│   ├── confirm-dialog/
│   │   ├── confirm-dialog.component.ts
│   │   └── confirm-dialog.component.html
│   └── sse.service.ts
├── guards/
│   └── auth.guard.ts
├── interceptors/
│   └── auth.interceptor.ts
└── models/
    ├── project.model.ts
    ├── session.model.ts
    ├── asset.model.ts
    └── sse-event.model.ts
```

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/src/app.module.ts` | 注册 AuthModule、ProjectModule、SessionModule、ChatModule、AssetModule |
| `server/src/main.ts` | 添加 cookie-parser 中间件 |
| `client/src/app/app.config.ts` | 添加路由、HTTP 拦截器 |
| `client/src/app/app.routes.ts` | 添加路由守卫 |
| `client/src/app/app.ts` | 布局调整（登录 → 项目列表 → 工作区） |
| `client/proxy.conf.json` | 端口 8080 → 3100 |
| `server/prisma/schema.prisma` | 新增 Project、Session、Asset 模型 |
| `.env` | 已存在，需确认 `ANTHROPIC_*` 完整 |

## API Contract

### Auth

```
POST   /api/v1/auth/login           # 登录 → Set-Cookie: token
POST   /api/v1/auth/logout          # 登出 → 清除 Cookie
GET    /api/v1/auth/me              # 获取当前用户信息
```

**POST /api/v1/auth/login**
```json
// Request
{ "username": "admin", "password": "oceanus123" }
// Response 200
{ "user": { "id": 1, "name": "Admin" } }
// Response 401
{ "message": "账号或密码错误", "statusCode": 401 }
// Set-Cookie: oceanus_token=<jwt>; HttpOnly; Path=/; Max-Age=86400
```

### Projects

```
GET    /api/v1/projects             # 项目列表
POST   /api/v1/projects             # 创建项目
GET    /api/v1/projects/:id         # 项目详情
PATCH  /api/v1/projects/:id         # 编辑项目
DELETE /api/v1/projects/:id         # 删除项目（级联删除 sessions + assets）
```

**GET /api/v1/projects**
```json
// Response 200
[{
  "id": 1,
  "uuid": "proj_xxxxxxxx",
  "name": "Oceanus MVP",
  "description": "需求讨论平台",
  "createdAt": "2026-07-23T00:00:00Z",
  "updatedAt": "2026-07-23T00:00:00Z"
}]
// Response 200 (空)
[]
```

**POST /api/v1/projects**
```json
// Request
{ "name": "Oceanus MVP", "description": "..." }
// Response 201
{ "id": 1, "uuid": "proj_xxxxxxxx", "name": "Oceanus MVP", ... }
// Response 400
{ "message": "项目名称不能为空", "statusCode": 400 }
```

**DELETE /api/v1/projects/:id**
```json
// Response 200
{ "message": "项目已删除" }
// Response 404
{ "message": "项目不存在", "statusCode": 404 }
```

### Sessions

```
GET    /api/v1/projects/:projectId/sessions          # 会话列表
POST   /api/v1/projects/:projectId/sessions          # 创建新会话
GET    /api/v1/sessions/:id                          # 会话详情
DELETE /api/v1/sessions/:id                          # 删除会话
```

**GET /api/v1/projects/:projectId/sessions**
```json
// Response 200
[{
  "id": 1,
  "uuid": "sess_xxxxxxxx",
  "title": "新会话",
  "status": "active",
  "filePath": "data/sessions/sess_xxxxxxxx.jsonl",
  "lastMessageAt": "2026-07-23T00:00:00Z",
  "createdAt": "2026-07-23T00:00:00Z"
}]
// Response 200 (空)
[]
```

**POST /api/v1/projects/:projectId/sessions**
```json
// Response 201
{ "id": 1, "uuid": "sess_xxxxxxxx", "title": "新会话", ... }
```

### Messages (via SDK)

```
GET    /api/v1/sessions/:id/messages   # 通过 SDK getSessionMessages() 读取
```

```json
// Response 200 — SDK 消息格式透传
[{ "role": "assistant", "content": [{ "type": "text", "text": "..." }] }]
```

### Chat/SSE

```
POST   /api/v1/sessions/:id/chat     # 发送消息 → 开启 SSE 流式响应
```

**POST /api/v1/sessions/:id/chat**
```json
// Request
{ "message": "我想做一个需求讨论平台" }
// Response 200 — SSE stream
event: text_chunk
data: {"text":"好的，我来分析一下您的需求。"}

event: tool_start
data: {"toolName":"tide-discuss","input":{...}}

event: tool_status
data: {"toolName":"tide-discuss","status":"正在分析需求背景"}

event: tool_confirm
data: {"options":["继续深入分析","换一个需求方向"],"allowFreeform":true}

event: asset_ready
data: {"assetId":1,"type":"prd","title":"PRD - Oceanus MVP"}

event: error
data: {"code":"AGENT_ERROR","message":"AI 服务暂时不可用"}

event: done
data: {"sessionId":"sess_xxxxxxxx"}
```

### Confirm (用户选择回传)

```
POST   /api/v1/sessions/:id/agent/confirm
```

```json
// Request
{ "choice": "继续深入分析" }
// Response 200
{ "received": true }
```

### Assets

```
GET    /api/v1/sessions/:sessionId/assets       # 资产列表
GET    /api/v1/assets/:id                       # 资产详情
GET    /api/v1/assets/:id/download              # 下载 .md 文件
POST   /api/v1/assets/:id/copy                  # 返回内容供复制
```

**GET /api/v1/sessions/:sessionId/assets**
```json
// Response 200
[{
  "id": 1,
  "type": "prd",
  "title": "PRD - Oceanus MVP",
  "content": "# PRD\n\n...",
  "createdAt": "2026-07-23T00:00:00Z"
}]
// Response 200 (空)
[]
```

## Data Model

```prisma
/// 项目
model Project {
  id          Int      @id @default(autoincrement())
  uuid        String   @unique @default(uuid())
  name        String
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  sessions    Session[]
  assets      Asset[]

  @@map("projects")
}

/// 会话
model Session {
  id            Int      @id @default(autoincrement())
  uuid          String   @unique @default(uuid())
  title         String   @default("新会话")
  status        String   @default("active") // active | completed
  filePath      String?  // data/sessions/{uuid}.jsonl
  lastMessageAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  projectId     Int
  project       Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assets        Asset[]

  @@map("sessions")
}

/// 资产 (PRD / Jira Task)
model Asset {
  id          Int      @id @default(autoincrement())
  uuid        String   @unique @default(uuid())
  type        String   // prd | jira_task
  title       String
  content     String   // Markdown
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  sessionId   Int
  session     Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  projectId   Int?
  project     Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("assets")
}
```

## Risks / Trade-offs

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Claude Agent SDK TypeScript 版本与 DeepSeek API 兼容性 | SDK 可能对非 Anthropic API 有未预期的行为 | 锁定 SDK 版本（实现时确认），设置 `ANTHROPIC_BASE_URL` 指向 DeepSeek endpoint |
| FileSystemSessionStore 并发写入 | 多请求同时 append 同一 JSONL 文件可能冲突 | SDK 的 append 操作对每个 session 是序列化的，暂不需要锁。后续如有需要可升级为 PostgresSessionStore |
| SSE 断线时 in-flight 数据丢失 | 缓冲区大小限制导致部分 token 无法回放 | 环形队列保留最新 4096 字符，超出时截断。核心历史由 JSONL 持久化保障 |
| Token 过期无 refresh | 用户工作期间被强制登出 | MVP 阶段 JWT 有效期设为 24h，足够单次使用 |
| 删除操作不可恢复 | 用户误删后无法找回 | 确认弹窗强调"不可恢复"。将来可考虑 7 天回收站（非 MVP） |
| Angular 21 + PrimeNG 21 最新版本 | 新版本可能有未发现的 bug | 使用 Lockfile 锁定版本 |

## Open Questions

- [ ] Claude Agent SDK TypeScript 具体版本：实现时执行 `npm view @anthropic-ai/claude-agent-sdk versions` 确认稳定版
- [ ] `confirm_result` 回传的 `choice` 字段—SDK 是否需要特定格式？实现时验证
- [ ] SDK `skills: "all"` 在 `settingSources: ["project"]` 下是否能正确发现 tide-discuss skill？实现时验证
- [ ] SessionStore adapter 的 `delete` 方法签名是否在 SDK 派生接口中？实现时验证
