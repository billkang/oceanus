## 1. 依赖安装

- [x] 1.1 安装 `@nestjs/throttler`、`@nestjs/throttler-storage-redis`、`ioredis` 依赖到 `server/package.json`
- [x] 1.2 更新 `.env.example` 添加所有新增环境变量说明

## 2. API Key 池

- [x] 2.1 创建 `server/src/common/key-pool/key-pool.module.ts`（Module 定义）
- [x] 2.2 创建 `server/src/common/key-pool/key-pool.service.ts`：从 `LLM_API_KEY_1..N` 和 `ANTHROPIC_API_KEY` 加载 Key
- [x] 2.3 实现 Least-Used 选择逻辑（Redis Hash 读写 + 原子递增）
- [x] 2.4 实现故障计数和自动切换逻辑
- [x] 2.5 实现 Redis 不可用时的降级（内存计数）
- [x] 2.6 实现 Key 池单元测试

## 3. 速率限制

- [x] 3.1 在 `app.module.ts` 中配置 `ThrottlerModule.forRoot()`（全局 + Redis Store）
- [x] 3.2 实现自定义 `ThrottlerGuard`，提取 JWT 用户 ID 作为限流 key
- [x] 3.3 在 `ChatController` 上应用全局限流守卫（60 RPM）
- [x] 3.4 在 `sendMessage` 方法上应用用户级限流守卫（5 RPM/user）
- [x] 3.5 统一 429 错误响应格式（与 `AllExceptionsFilter` 兼容）
- [x] 3.6 实现 SSE 流中限流错误事件推送
- [x] 3.7 实现速率限制单元测试

## 4. 请求队列

- [x] 4.1 创建 `server/src/common/queue/request-queue.module.ts`
- [x] 4.2 实现 `RequestQueueService`：FIFO 队列 + 信号量并发控制
- [x] 4.3 实现 `enqueue()` 方法：并发未超限直接执行，超限入队
- [x] 4.4 实现 `cancel()` 方法：支持从队列中移除请求
- [x] 4.5 新增 SSE 事件类型：`queued`、`queue_position`、`dequeued`
- [x] 4.6 集成队列到 `ChatService.sendAndStream()`：请求过队列分发
- [x] 4.7 实现请求队列单元测试

## 5. Cluster 模式

- [x] 5.1 修改 `main.ts`：添加 Cluster Master/Worker 分支逻辑
- [x] 5.2 实现 Worker 优雅退出（SIGTERM 处理）
- [x] 5.3 实现 Worker 崩溃自动重启
- [x] 5.4 实现 HealthController 返回 Worker 活跃数
- [x] 5.5 新增 `CLUSTER_ENABLED` 环境变量，默认不启用

## 6. Prisma 连接池配置

- [x] 6.1 修改 `prisma.service.ts`：添加 `connectionLimit` 参数
- [x] 6.2 启动时输出连接池配置日志
- [x] 6.3 验证 Cluster 模式下总连接数在 PG `max_connections` 范围内

## 7. AgentService 集成 Key 池

- [x] 7.1 修改 `agent.service.ts`：`sendMessage()` 从 KeyPool 获取 Key
- [x] 7.2 确认 SDK 是否支持动态 Key：如不支持，实现 `ANTHROPIC_API_KEY` 环境变量切换封装
- [x] 7.3 实现 Key 切换时的竞态保护（Singleton 请求级别的 Key 绑定）

## 8. 前端适配

- [x] 8.1 更新 SSE 事件类型定义：添加 `Queued | QueuePosition | Dequeued`
- [x] 8.2 实现排队提示卡片 UI（等待态，显示排队位置）
- [x] 8.3 实现排队位置更新 UI
- [x] 8.4 实现排队状态下的取消按钮
