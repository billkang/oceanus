# API 参考

> Oceanus 后端 HTTP API。全局前缀 `api/v1`，全部端点（含 `GET /api/v1/models`）需 JWT Bearer 鉴权。

## 认证

请求头携带：

```http
Authorization: Bearer <JWT>
```

---

## POST /api/v1/chat

统一聊天端点，按 `action` 分发。响应为 **SSE 流**（`text/event-stream`）。

### 请求体

| 字段            | 类型                                 | 必填                  | 说明                                                                   |
| --------------- | ------------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `action`        | `'message' \| 'confirm' \| 'cancel'` | 是                    | 操作类型                                                               |
| `content`       | `string`                             | message 必填          | 用户消息内容                                                           |
| `sessionId`     | `string`                             | confirm / cancel 必填 | SDK 会话 ID                                                            |
| `projectId`     | `string \| number`                   | 否                    | 关联项目                                                               |
| `confirmOption` | `string`                             | confirm 必填          | 用户选择的选项                                                         |
| `model`         | `string`                             | 否                    | 逻辑模型名（来自 `GET /models`）；省略用 `models.yaml` 的默认 provider |

### 响应（SSE 事件）

| 事件                                          | 说明                                             |
| --------------------------------------------- | ------------------------------------------------ |
| `message_delta`                               | 流式增量文本                                     |
| `message_complete`                            | 本轮 AI 回复完成                                 |
| `turn_limit_reached` / `budget_limit_reached` | 命中轮次/预算上限（data 携带 limit）             |
| `ai_not_configured`                           | AI 服务未配置（注册表缺失/默认 provider 不可用） |
| `error`                                       | 其他错误，data.message 含错误信息                |

### 错误

- `400`：未知 `action` / message 缺 `content` / confirm 缺 `confirmOption` / **未知 `model`（信息含可用列表）**

---

## GET /api/v1/models

获取可用模型列表（前端选择器单一事实来源）。同 JWT 守卫。

### 响应 `200`

```json
[{ "name": "deepseek", "displayName": "DeepSeek", "default": true }]
```

> 不含 `enabled: false` 的模型与不可解析（Key 缺失）的模型（当前 kimi 为 `enabled: false` 下线状态，故未列出）。

---

## GET /api/v1/sessions/:sdkSessionId/messages

获取会话历史消息。

### 响应 `200`

```json
[{ "id": "…", "role": "user", "content": "…", "timestamp": 1730000000000, "status": "done" }]
```

---

> 模型注册与 Key 配置见 `docs/1-getting-started/environment.md` 的「模型注册表」段与 `server/config/models.yaml`。
