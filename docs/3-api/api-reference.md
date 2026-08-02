# API 参考

> Oceanus 后端 HTTP API。全局前缀 `api/v1`，除 `POST /api/v1/auth/login` 外全部端点需 JWT Bearer 鉴权。

## 认证

请求头携带：

```http
Authorization: Bearer <JWT>
```

---

## 认证

### POST /api/v1/auth/login

用户登录，返回 JWT Token 与用户信息。

请求体：

| 字段       | 类型     | 必填 | 说明   |
| ---------- | -------- | ---- | ------ |
| `username` | `string` | 是   | 用户名 |
| `password` | `string` | 是   | 密码   |

响应 `200`：

```json
{
  "token": "<JWT>",
  "user": { "id": 1, "username": "admin", "displayName": "管理员" }
}
```

错误：`401` 账号或密码错误。

### GET /api/v1/auth/me

获取当前登录用户信息。

响应 `200`：`{ "id": 1, "username": "admin", "displayName": "管理员", "active": true, ... }`

---

## 项目管理

> 全部项目端点按当前用户成员关系过滤；非成员访问一律返回统一 `404`（不暴露资源存在性）。

### GET /api/v1/projects

项目列表（当前用户为成员的项目）。

响应 `200`：

```json
[
  {
    "id": 1,
    "uuid": "…",
    "projectName": "project-a",
    "displayName": "项目 A",
    "description": "…",
    "active": true,
    "sessionCount": 3
  }
]
```

### POST /api/v1/projects

创建项目（创建者自动成为 owner）。

请求体：

| 字段          | 类型     | 必填 | 说明                                                    |
| ------------- | -------- | ---- | ------------------------------------------------------- |
| `projectName` | `string` | 是   | 唯一标识，仅允许小写字母、数字、`-`、`_`，作为 URL 标识 |
| `displayName` | `string` | 是   | 项目显示名称                                            |
| `description` | `string` | 否   | 项目描述                                                |

响应 `201`：项目对象（含 `sessionCount: 0`）。

错误：`400` 字段缺失/`projectName` 格式不合法；`409` projectName 已存在。

### GET /api/v1/projects/:projectName

项目详情（仅成员）。

响应 `200`：项目对象（含 `sessionCount`）。

错误：非成员 → `404`。

### PATCH /api/v1/projects/:projectName

编辑项目（**owner-only**）。

请求体：`displayName`、`description` 任一或全部（均可选）。

错误：非 owner → `404`。

### DELETE /api/v1/projects/:projectName

删除项目（**owner-only**）。**软删**：`$transaction` 级联将全部会话、`SessionEntry`、资产、成员关系、项目本身置 `deletedAt`（读查询不可见）；项目物理目录随后移入回收站 `.trash/`（rename 失败仅记日志，不阻断 DB）。

响应 `200`：`{ "success": true }`。

错误：非 owner → `404`。

---

## 会话管理

> 会话按 `partitionKey = ${projectName}/${username}` 分区隔离；非成员/非 owner 访问一律 `404`。

### GET /api/v1/projects/:projectName/sessions

项目下的会话列表（仅当前用户的会话，按 `lastMessageAt` 倒序、null 最后）。

响应 `200`：

```json
[
  {
    "id": 1,
    "sdkSessionId": "…",
    "title": "…",
    "status": "active",
    "username": "admin",
    "lastMessageAt": "…",
    "project": { "projectName": "project-a", "displayName": "项目 A" }
  }
]
```

错误：非项目成员 → `404`。

### GET /api/v1/sessions/:sdkSessionId

会话详情（仅 owner）。

响应 `200`：会话对象（含 project）。

错误：非 owner / 不存在 → `404`。

### DELETE /api/v1/sessions/:sdkSessionId

删除会话（**owner-only**），`$transaction` 级联**软删**（`deletedAt` 置位，保留审计可恢复）：
`SessionEntry`（按 `partitionKey` + `sessionId`）→ `Asset`（按 `sessionId`）→ `Session`。
随后会话目录移入 `.trash/` 回收站（失败仅记日志，不阻断 DB 删除）。

响应 `200`：`{ "success": true }`。

错误：非 owner / 不存在 → `404`。

### GET /api/v1/sessions/:sdkSessionId/messages

获取会话历史消息。

响应 `200`：

```json
[{ "id": "…", "role": "user", "content": "…", "timestamp": 1730000000000, "status": "done" }]
```

---

## 聊天

### POST /api/v1/chat

统一聊天端点，按 `action` 分发。响应为 **SSE 流**（`text/event-stream`）。

请求体：

| 字段            | 类型                                 | 必填                  | 说明                                                                   |
| --------------- | ------------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `action`        | `'message' \| 'confirm' \| 'cancel'` | 是                    | 操作类型                                                               |
| `content`       | `string`                             | message 必填          | 用户消息内容                                                           |
| `sessionId`     | `string`                             | confirm / cancel 必填 | SDK 会话 ID                                                            |
| `projectName`   | `string`                             | 新会话首条消息必传    | 项目 projectName，用于成员校验 + 分区                                  |
| `confirmOption` | `string`                             | confirm 必填          | 用户选择的选项                                                         |
| `model`         | `string`                             | 否                    | 逻辑模型名（来自 `GET /models`）；省略用 `models.yaml` 的默认 provider |

响应（SSE 事件）：

| 事件                                          | 说明                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `message_delta`                               | 流式增量文本                                     |
| `message_complete`                            | 本轮 AI 回复完成                                 |
| `turn_limit_reached` / `budget_limit_reached` | 命中轮次/预算上限（data 携带 limit）             |
| `ai_not_configured`                           | AI 服务未配置（注册表缺失/默认 provider 不可用） |
| `error`                                       | 其他错误，data.message 含错误信息                |

错误：

- `400`：未知 `action` / message 缺 `content` / confirm 缺 `confirmOption` / **未知 `model`（信息含可用列表）** / 非项目成员或新会话缺 `projectName`
- `404`：`projectName` 指向的项目不存在或当前用户非成员

---

## 模型

### GET /api/v1/models

获取可用模型列表（前端选择器单一事实来源）。同 JWT 守卫。

响应 `200`：

```json
[{ "name": "deepseek", "displayName": "DeepSeek", "default": true }]
```

> 不含 `enabled: false` 的模型与不可解析（Key 缺失）的模型（当前 kimi 为 `enabled: false` 下线状态，故未列出）。

---

## 资产

### GET /api/v1/sessions/:sessionId/assets

会话产出的资产列表（owner-only，非 owner → `404`）。

### GET /api/v1/assets/:id

资产详情（owner-only）。

### GET /api/v1/assets/:id/download

资产下载（owner-only）。

### POST /api/v1/assets/:id/copy

复制资产（owner-only）。

---

> 模型注册与 Key 配置见 `docs/1-getting-started/environment.md` 的「模型注册表」段与 `server/config/models.yaml`。
