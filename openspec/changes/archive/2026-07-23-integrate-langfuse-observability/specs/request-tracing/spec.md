## ADDED Requirements

### Requirement: 自动 traceId 生成
系统 SHALL 在每次 HTTP 请求入口自动生成一个全局唯一的 traceId。
traceId 格式 SHALL 为 UUID v4（如 `550e8400-e29b-41d4-a716-446655440000`）。
生成时机 SHALL 在请求进入 NestJS 的第一个中间件/拦截器时完成。

#### Scenario: 请求携带 traceId
- **WHEN** 客户端发送 HTTP 请求到任意后端 API
- **THEN** 请求日志中自动包含 `traceId` 字段
- **AND** 同一请求的所有日志行共享同一个 traceId

#### Scenario: traceId 格式
- **WHEN** 检查 traceId 值
- **THEN** 其格式符合 UUID v4 标准

### Requirement: traceId 与 sessionId 分离
traceId SHALL 是请求级别标识，sessionId 是会话级别标识，两者独立存在。
同一 sessionId 的多次 HTTP 请求 SHALL 有不同的 traceId。

#### Scenario: 多请求同会话
- **WHEN** 同一个 session 内先后发送 3 次 HTTP 请求
- **THEN** 每次请求的 traceId 均不同
- **AND** 每次请求的 sessionId 相同

### Requirement: traceId 未携带时自动生成
无论请求头中是否携带 `X-Trace-Id`，系统 SHALL 自动生成并覆盖 traceId（不信任客户端传入的 traceId，避免篡改）。

#### Scenario: 请求头携带 traceId
- **WHEN** 客户端在请求头中设置了 `X-Trace-Id: user-provided-id`
- **THEN** 系统忽略该值，仍使用自动生成的 UUID 作为 traceId

### Requirement: 日志上下文传播
traceId SHALL 在 NestJS 的请求上下文（`ExecutionContext`/`CLS`）内传播，确保异步操作中日志仍能关联到正确的 traceId。

#### Scenario: 异步日志关联
- **WHEN** 请求触发了多个异步操作（如数据库查询、SDK 调用、文件写入）
- **THEN** 所有异步操作的日志行均包含正确的 traceId
