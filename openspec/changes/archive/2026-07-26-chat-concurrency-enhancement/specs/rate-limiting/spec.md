## ADDED Requirements

### Requirement: 全局速率限制

系统 SHALL 对所有未认证和已认证的 `/chat` 请求设置全局速率上限，防止突发流量冲击。

#### Scenario: 全局超额拒绝

- **WHEN** 1 分钟内全局 `/chat` 请求超过 `GLOBAL_RATE_LIMIT_LIMIT`（默认 60）
- **THEN** 系统返回 HTTP 429
- **THEN** 响应体中包含 `retryAfter` 字段，指示客户端等待秒数

#### Scenario: 全局限流不影响其他端点

- **WHEN** 全局 `/chat` 请求达到速率上限
- **THEN** 其他端点（如 `/sessions/:id/messages`、`/projects`）不受影响

### Requirement: 用户级速率限制

系统 SHALL 根据 JWT 用户身份对每个用户单独限流，防止单个用户滥用。

#### Scenario: 用户超额拒绝

- **WHEN** 同一 JWT 用户 1 分钟内 `/chat` 请求超过 `USER_RATE_LIMIT_LIMIT`（默认 5）
- **THEN** 系统返回 HTTP 429
- **THEN** 响应体指明剩余等待时间

#### Scenario: 不同用户互不影响

- **WHEN** 用户 A 达到速率上限被拒绝
- **THEN** 用户 B 仍可正常发送请求（不超过用户 B 的上限）

#### Scenario: 未认证请求限流

- **WHEN** 未携带有效 JWT Token 的请求到达 `/chat`
- **THEN** 请求被 JwtAuthGuard 在限流之前拦截
- **THEN** 返回 401 错误（JWT 守卫优先于限流守卫）

### Requirement: 限流响应格式

系统 SHALL 在限流拒绝时返回标准化的 JSON 错误响应。

#### Scenario: 标准限流响应

- **WHEN** 请求被限流守卫拒绝
- **THEN** HTTP Status 为 429
- **THEN** 响应体格式为 `{ "success": false, "statusCode": 429, "message": "请求过于频繁，请 30 秒后重试", "retryAfter": 30 }`

### Requirement: 限流信息透传（SSE）

对于已进入 SSE 流的 `/chat` 请求，如果后续触发限流，SHALL 在 SSE 流中发送错误事件而非断开连接。

#### Scenario: 流中限流处理

- **WHEN** 请求已进入 SSE 流但触发限流
- **THEN** SSE 流发送 `{ type: "error", data: { message: "请求过于频繁，请稍后重试" } }`
- **THEN** SSE 流正常结束（`stream_complete` 或 `res.end()`）
