## Why

Oceanus 的 `/chat` 接口当前没有任何并发控制和速率限制。当多用户同时调用 AI 时，会直接冲击 LLM API 的速率限制（429），请求直接失败，用户体验差。同时，Node.js 单进程模式浪费了多核 CPU 资源。需要建立完整的并发支撑体系，保证服务在多用户场景下的稳定性和响应质量。

## What Changes

- 新增 API Key 池，支持多个 LLM API Key 按 Least-Used 策略轮换，提升并发配额
- 新增速率限制（Rate Limiter），按 JWT 用户身份做访问控制，防止滥用
- 新增内存请求队列（FIFO），LLM API 并发超限时请求排队等候，不直接拒绝
- 新增 Node.js Cluster 模式，利用多核 CPU 并行处理请求
- 优化 Prisma 连接池配置，适配 Cluster 多进程场景
- 新增 Key 池健康状态监控，失败自动切换 Key
- 新增对应的配置环境变量支持

## Capabilities

### New Capabilities

- `api-key-pool`: 多 Key 管理与 Least-Used 策略轮换，支持自动故障切换
- `rate-limiting`: 基于 JWT 用户身份的分级速率限制
- `request-queue`: FIFO 内存队列，超出并发时排队等待 LLM API 响应
- `cluster-mode`: Node.js 原生 Cluster 模块，多 worker 共享负载
- `prisma-pool-tuning`: Prisma 连接池显式配置与 worker 适配

### Modified Capabilities

- `chat`: `/chat` 的 SSE 端点将集成队列和限流逻辑（spec-level 行为变化：不再直接调用 AI，而是经过队列分发）

## Out of Scope

1. 不做 WebSocket 改造，SSE 保持当前模式
2. 不做请求优先级分级，统一 FIFO
3. 不做队列持久化到磁盘/DB（重启清空）
4. 不做动态扩缩容
5. 不做多区域部署
6. 不做 Key 自动续期/购买/发现
7. 不做 API 调用次数计费/计量
8. 不做 SSE 连接数的限流（仅限制 AI 请求层）
9. Cluster 模式不引入 PM2，使用原生 `cluster` 模块
10. 不做请求去重（相同请求不合并）

## Known Risks

| 风险                                                                            | 影响                                  | 缓解措施                                       |
| ------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Redis 不可用导致跨进程状态共享失效                                              | 限流和 Key 计数退化为进程级别，不精确 | 实现优雅降级，单进程模式仍正常工作             |
| Cluster Worker 数 × Prisma 连接数 > PG max_connections                          | 数据库连接失败                        | 启动时校验并输出警告                           |
| 内存队列在容器重启后丢失排队中的请求                                            | 用户请求丢失                          | 排队的请求在前端有状态提示，服务重启后重新入队 |
| Key 池中所有 Key 同时耗尽配额                                                   | AI 服务不可用                         | 降级返回 503，日志告警                         |
| Redis 降级时 Cluster 各 Worker 独立计数，Least-Used 可能导致同一 Key 被并发选中 | 单 Key 瞬时过载                       | 降级时临时改用 Round-Robin 避免热点            |
| 队列重启丢失 + 前端只看到空 SSE 流结束                                          | 用户感知请求静默消失                  | 前端实现超时自动重新入队机制                   |
| @nestjs/throttler Redis Store 在高延迟时拖慢每个请求                            | 限流本身成为性能瓶颈                  | 评估本地缓存 + 异步同步备选方案                |

## Validation

| 验证项          | 方法                                                    |
| --------------- | ------------------------------------------------------- |
| 单 Key 正常使用 | 手动测试 /chat 单用户会话                               |
| Key 池轮换      | 单元测试 Least-Used 选择逻辑 + 集成测试多 Key 切换      |
| 速率限制生效    | 单元测试 + 快速连续请求验证 429                         |
| 请求排队        | 设置 `MAX_CONCURRENT_LLM=1`，同时发起两请求验证排队事件 |
| 取消排队        | 请求入队后发 cancel 验证移除                            |
| Cluster 多进程  | 启动后验证多个 Worker 处理请求，健康检查返回 Worker 数  |
| Prisma 连接池   | 启动日志确认 `connection_limit` 生效                    |

## Impact

- **API**：`/chat` 端点行为变化 — 在并发超限时返回排队状态而非直接处理
- **Dependencies**：新增 `@nestjs/throttler`、`ioredis`（跨进程状态共享）
- **Configuration**：`.env` 新增 `LLM_API_KEY_1..N`（多行 Key 编号方式）、`CLUSTER_ENABLED`、`MAX_CONCURRENT_LLM`、`GLOBAL_RATE_LIMIT_LIMIT`、`GLOBAL_RATE_LIMIT_TTL`、`USER_RATE_LIMIT_LIMIT`、`USER_RATE_LIMIT_TTL`、`REQUEST_QUEUE_MAX_SIZE`、`PRISMA_CONNECTION_LIMIT`、`LLM_API_MAX_RETRIES` 等变量
- **Deployment**：Docker 容器保持单副本（P2 再处理多副本），Cluster 模式在容器内多进程
- **Testing**：新增测试文件：
  - `key-pool.service.spec.ts` — Least-Used 选择、故障切换、Redis 降级
  - `request-queue.service.spec.ts` — 入队/出队/取消/FIFO 顺序/队列满拒绝
  - `rate-limiting.guard.spec.ts` — 全局限流、用户级限流、429 响应格式
  - `cluster-mode.e2e-spec.ts` — 多 Worker 请求分发、优雅退出
  - `prisma-pool.e2e-spec.ts` — connection_limit 启动日志验证
