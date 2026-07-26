## Context

Oceanus 当前以单进程模式运行 NestJS 应用，`/chat` 端点直接调用 Claude Agent SDK `query()` 向 LLM API 发起请求。当多用户并发使用时：

1. **无速率限制**：单个用户可以无限刷请求
2. **无请求队列**：超出 LLM API 额度时请求直接 429 失败
3. **无 Key 池**：只能用一个 API Key，单 Key 配额即系统上限
4. **单进程**：多核 CPU 只有一个核心在工作
5. **Prisma 连接池**：使用 Prisma 默认连接池值，未显式配置

### 当前架构

```
Client ──→ /api/v1/chat ──→ ChatController ──→ ChatService.sendAndStream()
                                                      │
                                                      ▼
                                               AgentService.sendMessage()
                                                      │
                                                      ▼
                                               SDK query() ──→ LLM API
```

### 目标架构

```
Client ──→ /api/v1/chat ──→ ThrottlerGuard ──→ QueueGuard ──→ ChatService
                                          │                        │
                                          ▼                        ▼
                                   429 被拒 ←               KeyPool.select()
                                                                │
                                                                ▼
                                                          SDK query(K₁)
```

## Goals / Non-Goals

**Goals:**

- 支撑多用户同时使用 `/chat` 时的系统稳定性
- LLM API Key 配额不足时友好排队，而非直接中断
- 利用多核 CPU 提升吞吐量
- 防止单个用户滥用系统资源

**Non-Goals:**

- 不改变 SSE 流式传输模型
- 不引入消息队列中间件（Bull/RabbitMQ）
- 不做持久化队列（重启丢失）
- 不做跨容器水平扩展（P2）

## Decisions

### D1: Key 池实现 —— Redis Hash 存储 + Least-Used 计数

**选择：** 使用 `ioredis` 连接已有 Redis，将 Key 计数存储在 Redis Hash 中。

```
Key: oceanus:keypool:counts    Hash
├── sk-key-1 → 42              (使用次数)
├── sk-key-2 → 38
└── sk-key-3 → 47

Key: oceanus:keypool:failures   Hash
├── sk-key-1 → 2               (失败次数)
├── sk-key-2 → 0
└── sk-key-3 → 5
```

- Least-Used 选择：`HGETALL oceanus:keypool:counts` → 找最小值
- 使用后原子递增：`HINCRBY oceanus:keypool:counts <key> 1`
- 故障递增：`HINCRBY oceanus:keypool:failures <key> 1`
- 自动恢复：定期检查故障计数，若长时间无新故障则清零

**替代方案考虑：**

- 纯内存 Map → Cluster 模式下每个 worker 各自计数，Least-Used 失效
- Redis Sorted Set → Hash 更简单，单次 HGETALL 即可

### D2: 速率限制 —— @nestjs/throttler + Redis Store

**选择：** 使用 `@nestjs/throttler` 库，双层守卫：

```
全局守卫 @Throttle({ default: { limit: 60, ttl: 60000 } })
  └── 作用于所有 /chat 请求

用户级守卫 @Throttle({ default: { limit: 5, ttl: 60000 } })
  └── 基于 JWT payload.sub 或 req.user.id
```

- 全局守卫用 Redis store 跨进程共享限流状态
- 用户级守卫用 Redis store（Key: `throttler:user:{userId}`）
- 引入 `@nestjs/throttler-storage-redis` 包

### D3: 请求队列 —— 内存 FIFO + 信号量控制

**选择：** 不用消息队列中间件，使用 `Promise` 队列 + 信号量模式：

```typescript
class RequestQueue {
  private queue: QueuedRequest[] = []; // FIFO 队列
  private activeCount = 0; // 当前活跃请求数
  private maxConcurrent: number; // MAX_CONCURRENT_LLM
  private maxQueueSize: number; // REQUEST_QUEUE_MAX_SIZE

  // 核心方法
  async enqueue<T>(request: QueuedRequest): Promise<ProcessResult<T>> {
    if (activeCount < maxConcurrent) {
      activeCount++;
      return processImmediately(request); // 直接执行
    }
    if (queue.length >= maxQueueSize) {
      return { status: 'rejected', reason: 'queue_full' }; // 429
    }
    return new Promise((resolve) => {
      queue.push({ request, resolve }); // 入队等待
    });
  }

  private dequeue() {
    if (queue.length > 0 && activeCount < maxConcurrent) {
      const next = queue.shift()!;
      activeCount++;
      processImmediately(next.request).then(next.resolve);
    }
  }
}
```

- 入队时 SSE 发送 `queued` 事件
- 出队时 SSE 发送 `dequeued` 事件
- `activeCount` 在请求完成后 -1，触发 dequeue

**为什么不用 Bull：** 项目已经跑着 Redis，但当前场景不需要持久化队列，内存队列 + 信号量模式更轻量。

### D4: Cluster 模式 —— Node.js 原生 cluster

**选择：** 在 `main.ts` 入口区分 Master/Worker：

```typescript
// main.ts (精简逻辑)
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // ... 现有配置
  await app.listen(port);
}

if (process.env.CLUSTER_ENABLED === 'true' && cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  for (let i = 0; i < cpuCount; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    logger.warn(`Worker ${worker.process.pid} died, restarting...`);
    cluster.fork();
  });
} else {
  bootstrap();
}
```

- Master 不执行 bootstrap，仅管理 Worker 生命周期
- Worker 之间通过 Redis 共享 Key 池和限流状态
- HTTP 请求由 Node.js 内置的 cluster round-robin 分发

### D5: Prisma 连接池 —— 显式 connection_limit

```typescript
// prisma.service.ts
super({
  datasources: { db: { url } },
  // 关键：
  ...(process.env.PRISMA_CONNECTION_LIMIT ? { connectionLimit: Number(process.env.PRISMA_CONNECTION_LIMIT) } : {}),
});
```

- 单进程默认 10，Cluster 模式下默认 4/worker
- Prisma 的 `connectionLimit` 字段名需要确认（v6 可能为 `connection_limit`）

### D6: Key 池初始化

从环境变量 `LLM_API_KEY_1`、`LLM_API_KEY_2` … `LLM_API_KEY_N` 加载：

```typescript
// key-pool.service.ts
private loadKeysFromEnv(): string[] {
  const keys: string[] = [];
  for (let i = 1; ; i++) {
    const key = process.env[`LLM_API_KEY_${i}`];
    if (!key) break;
    keys.push(key);
  }
  if (keys.length === 0 && process.env.ANTHROPIC_API_KEY) {
    keys.push(process.env.ANTHROPIC_API_KEY); // 向后兼容
  }
  return keys;
}
```

### D7: Key 选择注入到 AgentService

当前 `agent.service.ts` 在 `sendMessage()` 中直接创建 `query()` 调用。改为传入已选择的 Key：

```typescript
// agent.service.ts
async sendMessage(content: string, options?: { resume?: string; apiKey?: string }) {
  const key = options?.apiKey ?? this.keyPool.select();
  // 或者在调用 query() 之前设置 process.env.ANTHROPIC_API_KEY
  // 或者通过 SDK options 传入 key
}
```

**注意：** 需要确认 Claude Agent SDK `^0.3.218` 是否支持在调用时动态指定 API Key。如果不支持，需要在调用前切换 `process.env.ANTHROPIC_API_KEY`（通过环境变量覆盖），或通过 `ANTHROPIC_BASE_URL` 适配器的 header 注入。这是实现中需要验证的关键点。

## Change Scope Matrix

| 模块/文件                                               | 改动类型   | 说明                                                                   |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `server/src/main.ts`                                    | **修改**   | 添加 Cluster 主/从逻辑                                                 |
| `server/src/prisma/prisma.service.ts`                   | **修改**   | 添加显式 connectionLimit                                               |
| `server/src/agent/agent.service.ts`                     | **修改**   | 集成 Key 池选择和动态 Key                                              |
| `server/src/chat/chat.service.ts`                       | **修改**   | 集成队列守卫                                                           |
| `server/src/chat/chat.controller.ts`                    | **修改**   | 添加 ThrottlerGuard                                                    |
| (新) `server/src/common/key-pool/key-pool.service.ts`   | **新增**   | Key 池管理                                                             |
| (新) `server/src/common/key-pool/key-pool.module.ts`    | **新增**   | Key 池模块                                                             |
| (新) `server/src/common/queue/request-queue.service.ts` | **新增**   | 请求队列                                                               |
| (新) `server/src/common/queue/request-queue.module.ts`  | **新增**   | 队列模块                                                               |
| (新) `server/src/agent/types/sse-events.ts`             | **修改**   | 添加 queued/dequeued/queue_position 事件类型                           |
| `server/src/common/filters/all-exceptions.filter.ts`    | **修改**   | 适配 429 限流响应格式                                                  |
| `server/.env.example`                                   | **修改**   | 新增环境变量说明                                                       |
| `server/package.json`                                   | **修改**   | 新增 `@nestjs/throttler`、`@nestjs/throttler-storage-redis`、`ioredis` |
| `server/prisma/schema.prisma`                           | **无变化** | 无需改数据模型                                                         |

## API Contract

### POST /api/v1/chat （新增队列事件）

新增 SSE 事件类型：

```typescript
// agent/types/sse-events.ts 新增
export enum SseEventType {
  // ... 现有事件
  Queued = 'queued',
  QueuePosition = 'queue_position',
  Dequeued = 'dequeued',
}

// queued 事件
{ type: 'queued', data: { position: 3, estimatedWait: '约 30 秒' } }

// queue_position 更新
{ type: 'queue_position', data: { position: 2, totalBefore: 2 } }

// dequeued 事件
{ type: 'dequeued', data: {} }
```

### 429 响应格式

```json
{
  "success": false,
  "statusCode": 429,
  "message": "请求过于频繁，请 30 秒后重试",
  "retryAfter": 30
}
```

## Risks / Trade-offs

| 风险                                                    | 影响                      | 缓解措施                                                           |
| ------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| Cluster 模式下所有 Worker 同时启动连接 DB，冲击 PG      | 启动时短暂高连接数        | Prisma 连接池按需创建，非启动即创建                                |
| @nestjs/throttler 的 Redis store 与 Langfuse 共用 Redis | 限流数据可能影响 Langfuse | 限流 Key 加前缀 `throttler:`，到期自动清理                         |
| 内存队列重启丢失                                        | 排队的请求丢失            | 前端缓存排队状态，5xx 时自动重新入队                               |
| SDK 不支持运行时切换 API Key                            | Key 池策略失效            | 方案 A：环境变量覆盖 `ANTHROPIC_API_KEY`；方案 B：HTTP header 注入 |

## Open Questions

1. **Claude Agent SDK `^0.3.218` 是否支持 request-level API Key 覆盖？** 如果不支持，需要通过 `ANTHROPIC_API_KEY` 环境变量切换（全局生效，需加锁避免竞态）
2. **`@nestjs/throttler-storage-redis` 是否兼容 NestJS 11？** 需要确认版本兼容性
3. **Cluster 模式下 NestJS 的 Terminus 健康检查是否正常返回 Worker 状态？** Master 进程不创建 NestJS 应用，需要额外暴露一个轻量 HTTP 端点
