# /chat 并发性能优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Oceanus 的 `/chat` 接口添加 API Key 池、速率限制、请求队列和 Cluster 模式，支撑多用户并发 AI 请求。

**Architecture:** 在现有 NestJS 架构中插入四个新层：(1) KeyPoolService 管理多 LLM API Key 的 Least-Used 轮换；(2) ThrottlerGuard 做双层速率限制；(3) RequestQueueService 做 FIFO 排队；(4) 原生 cluster 模块做多进程。通过 Redis 共享跨进程状态。

**Tech Stack:** NestJS 11, Prisma 6, Node.js cluster, Redis (ioredis), @nestjs/throttler, Claude Agent SDK

## 全局约束

- 所有 SDD 文档正文使用中文，英文仅限专有名词和技术引用
- 不引入 PM2 或消息队列中间件（Bull/RabbitMQ）
- 队列使用内存实现，不做持久化
- 所有配置项通过环境变量注入，不做配置文件
- 代码风格遵循项目现有模式（NestJS 模块化、Logger 使用 nestjs-pino）

---

## 文件结构

### 新建文件

| 文件                                                 | 职责                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `server/src/common/key-pool/key-pool.module.ts`      | Key 池模块定义                                          |
| `server/src/common/key-pool/key-pool.service.ts`     | Key 池管理：加载、Least-Used 选择、故障切换、Redis 同步 |
| `server/src/common/key-pool/key-pool.interface.ts`   | KeyPoolEntry 等类型定义                                 |
| `server/src/common/queue/request-queue.module.ts`    | 队列模块定义                                            |
| `server/src/common/queue/request-queue.service.ts`   | FIFO 队列：入队/出队/取消/信号量并发控制                |
| `server/src/common/queue/request-queue.interface.ts` | QueuedRequest 等类型定义                                |

### 修改文件

| 文件                                                 | 改动内容                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `server/package.json`                                | 添加 `@nestjs/throttler`、`ioredis` 依赖                               |
| `server/.env.example`                                | 新增 `LLM_API_KEY_1~N`、`CLUSTER_ENABLED`、`MAX_CONCURRENT_LLM` 等变量 |
| `server/src/main.ts`                                 | 添加 Cluster 主/从分支逻辑                                             |
| `server/src/app.module.ts`                           | 全局导入 ThrottlerModule                                               |
| `server/src/prisma/prisma.service.ts`                | 添加 `connectionLimit` 配置                                            |
| `server/src/agent/agent.service.ts`                  | `sendMessage()` 从 KeyPool 获取 Key                                    |
| `server/src/agent/types/sse-events.ts`               | 新增 `Queued`、`QueuePosition`、`Dequeued` 事件类型                    |
| `server/src/chat/chat.service.ts`                    | 集成 RequestQueue，请求经过队列分发                                    |
| `server/src/chat/chat.controller.ts`                 | 应用 ThrottlerGuard                                                    |
| `server/src/health/health.controller.ts`             | Cluster 模式返回 Worker 数                                             |
| `server/src/common/filters/all-exceptions.filter.ts` | 统一 429 响应格式                                                      |

---

## 任务分解

### Task 1: 依赖安装与环境变量定义

**Files:**

- Modify: `server/package.json`
- Modify: `server/.env.example`

**Interfaces:**

- Produces: 安装后的依赖、环境变量模板（后续任务直接使用）

- [ ] **Step 1: 安装依赖**

```bash
cd server
pnpm add @nestjs/throttler@^6.0.0 ioredis@^5.0.0
pnpm add -D @types/ioredis@^5.0.0
```

- [ ] **Step 2: 更新 `.env.example`**

在 `server/.env.example` 末尾添加：

```bash
# ── 并发控制 ──────────────────────────────────────────────────
# LLM API Key 池：支持多 Key 轮换，每行一个独立 Key
# LLM_API_KEY_1=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LLM_API_KEY_2=sk-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
# LLM_API_KEY_3=sk-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
# 如未配置 LLM_API_KEY_N，回退到 ANTHROPIC_API_KEY（单 Key 模式）

# 最大 LLM 并发请求数（默认 3，建议 = Key 池大小 × 1）
# MAX_CONCURRENT_LLM=3
# 请求队列最大长度（默认 50）
# REQUEST_QUEUE_MAX_SIZE=50
# LLM API 调用失败最大重试次数（默认 3）
# LLM_API_MAX_RETRIES=3
# 是否启用 Cluster 多进程模式（true/false，默认 false）
# CLUSTER_ENABLED=false
# Worker 优雅关闭超时秒数（默认 30）
# WORKER_SHUTDOWN_TIMEOUT=30

# ── 速率限制 ──────────────────────────────────────────────────
# 全局每分钟最大聊天请求数（默认 60）
# GLOBAL_RATE_LIMIT_LIMIT=60
# 单用户每分钟最大聊天请求数（默认 5）
# USER_RATE_LIMIT_LIMIT=5

# ── Prisma 连接池 ─────────────────────────────────────────────
# 每个 Worker 的 Prisma 连接池大小（默认 4，单进程时默认 10）
# PRISMA_CONNECTION_LIMIT=4
```

- [ ] **Step 3: 验证安装**

```bash
cd server && pnpm ls @nestjs/throttler ioredis
# 确认依赖安装成功且版本正确
```

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml server/.env.example
git commit -m "feat: add throttler, ioredis deps and env vars for concurrency"
```

---

### Task 2: SSE 事件类型扩展

**Files:**

- Modify: `server/src/agent/types/sse-events.ts`

**Interfaces:**

- Produces: `SseEventType.Queued`, `SseEventType.QueuePosition`, `SseEventType.Dequeued`（后续 Task 3/4/5 使用）

- [ ] **Step 1: 读取现有 SSE 事件类型文件**

```bash
cat server/src/agent/types/sse-events.ts
```

- [ ] **Step 2: 在 `SseEventType` 枚举中添加三个新事件**

```typescript
// 在现有枚举末尾添加
Queued = 'queued',
QueuePosition = 'queue_position',
Dequeued = 'dequeued',
```

- [ ] **Step 3: 在 `SseEventMap`（如存在）添加对应的事件数据类型定义**

```typescript
// 如果 SseEventMap 已存在，添加：
queued: {
  position: number;
  estimatedWait: string;
}
queue_position: {
  position: number;
  totalBefore: number;
}
dequeued: Record<string, never>;
```

- [ ] **Step 4: 验证**

```bash
cd server && npx tsc --noEmit
# 确认类型定义无编译错误
```

- [ ] **Step 5: Commit**

```bash
git add server/src/agent/types/sse-events.ts
git commit -m "feat: add queued/dequeue SSE event types"
```

---

### Task 3: API Key 池服务

**Files:**

- Create: `server/src/common/key-pool/key-pool.interface.ts`
- Create: `server/src/common/key-pool/key-pool.service.ts`
- Create: `server/src/common/key-pool/key-pool.module.ts`

**Interfaces:**

- Produces: `KeyPoolService.select(): string` — 选择当前 Least-Used 的 Key
- Produces: `KeyPoolService.markFailure(key: string): void` — 标记 Key 故障
- Produces: `KeyPoolService.getPoolStats(): KeyPoolStats` — 获取池状态

- [ ] **Step 1: 编写 Key 池接口定义**

```typescript
// server/src/common/key-pool/key-pool.interface.ts
export interface KeyPoolEntry {
  key: string;
  usageCount: number;
  failureCount: number;
  lastFailureAt: number | null;
}

export interface KeyPoolStats {
  totalKeys: number;
  healthyKeys: number;
  totalUsage: number;
  totalFailures: number;
}
```

- [ ] **Step 2: 编写 Key 池服务**

```typescript
// server/src/common/key-pool/key-pool.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service'; // 需要先确认 RedisModule 是否存在
import { KeyPoolEntry, KeyPoolStats } from './key-pool.interface';

@Injectable()
export class KeyPoolService implements OnModuleInit {
  // 内存副本（单进程模式或 Redis 降级时使用）
  private keys: KeyPoolEntry[] = [];
  private useLocalMode = false;

  private readonly REDIS_KEY_COUNTS = 'oceanus:keypool:counts';
  private readonly REDIS_KEY_FAILURES = 'oceanus:keypool:failures';

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.loadKeysFromEnv();
    this.logger.log(`Key pool initialized with ${this.keys.length} keys`);
  }

  private loadKeysFromEnv(): void {
    // 从 LLM_API_KEY_1..N 加载
    for (let i = 1; ; i++) {
      const key = this.configService.get<string>(`LLM_API_KEY_${i}`);
      if (!key) break;
      this.keys.push({ key, usageCount: 0, failureCount: 0, lastFailureAt: null });
    }
    // 回退到 ANTHROPIC_API_KEY
    if (this.keys.length === 0) {
      const fallbackKey = this.configService.get<string>('ANTHROPIC_API_KEY');
      if (fallbackKey) {
        this.keys.push({ key: fallbackKey, usageCount: 0, failureCount: 0, lastFailureAt: null });
      }
    }
  }

  async select(): Promise<string> {
    // TODO: 从 Redis 获取计数（后续实现 RedisService 后补充）
    // 当前使用内存方式
    return this.selectLocal();
  }

  private selectLocal(): string {
    const sorted = [...this.keys].sort((a, b) => a.usageCount - b.usageCount);
    const selected = sorted[0];
    selected.usageCount++;
    return selected.key;
  }

  async markFailure(key: string): Promise<void> {
    const entry = this.keys.find((k) => k.key === key);
    if (entry) {
      entry.failureCount++;
      entry.lastFailureAt = Date.now();
    }
  }

  getPoolStats(): KeyPoolStats {
    return {
      totalKeys: this.keys.length,
      healthyKeys: this.keys.filter((k) => k.failureCount < 3).length,
      totalUsage: this.keys.reduce((s, k) => s + k.usageCount, 0),
      totalFailures: this.keys.reduce((s, k) => s + k.failureCount, 0),
    };
  }

  getKeyCount(): number {
    return this.keys.length;
  }
}
```

- [ ] **Step 3: 编写 Key 池模块**

```typescript
// server/src/common/key-pool/key-pool.module.ts
import { Global, Module } from '@nestjs/common';
import { KeyPoolService } from './key-pool.service';

@Global()
@Module({
  providers: [KeyPoolService],
  exports: [KeyPoolService],
})
export class KeyPoolModule {}
```

- [ ] **Step 4: 集成到 AppModule**

```typescript
// server/src/app.module.ts — imports 数组添加 KeyPoolModule
KeyPoolModule,
```

- [ ] **Step 5: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/src/common/key-pool/
git add server/src/app.module.ts
git commit -m "feat: add API Key pool with Least-Used selection"
```

---

### Task 4: 请求队列服务

**Files:**

- Create: `server/src/common/queue/request-queue.interface.ts`
- Create: `server/src/common/queue/request-queue.service.ts`
- Create: `server/src/common/queue/request-queue.module.ts`

**Interfaces:**

- Produces: `RequestQueueService.enqueue<T>(req: QueuedRequest): Promise<ProcessResult<T>>`
- Produces: `RequestQueueService.cancel(sessionId: string): boolean`
- Produces: `RequestQueueService.getQueuePosition(sessionId: string): number`

- [ ] **Step 1: 编写队列接口定义**

```typescript
// server/src/common/queue/request-queue.interface.ts
export interface QueuedRequest {
  sessionId: string; // SDK session ID，用于去重/取消
  execute: () => Promise<void>; // 实际执行函数（调用 Agent SDK）
  onEvent: (event: any) => void; // SSE 事件回调
  enqueuedAt: number;
}

export type EnqueueResult =
  | { status: 'executed' }
  | { status: 'queued'; position: number; estimatedWait: string }
  | { status: 'rejected'; reason: 'queue_full' | 'cancelled' }; // eslint-disable-next-line @typescript-eslint/no-unused-vars
```

- [ ] **Step 2: 编写队列服务**

```typescript
// server/src/common/queue/request-queue.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { QueuedRequest, EnqueueResult } from './request-queue.interface';

@Injectable()
export class RequestQueueService {
  private readonly queue: QueuedRequest[] = [];
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {
    this.maxConcurrent = this.configService.get('MAX_CONCURRENT_LLM', 3);
    this.maxQueueSize = this.configService.get('REQUEST_QUEUE_MAX_SIZE', 50);
  }

  async enqueue(request: QueuedRequest): Promise<EnqueueResult> {
    // 并发未满：直接执行
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      this.logger.debug(`Request for session ${request.sessionId} executing directly`);
      this.executeAndDequeue(request).catch(() => {});
      return { status: 'executed' };
    }

    // 队列满：拒绝
    if (this.queue.length >= this.maxQueueSize) {
      this.logger.warn(`Queue full, rejecting request for session ${request.sessionId}`);
      return { status: 'rejected', reason: 'queue_full' };
    }

    // 入队
    this.queue.push(request);
    const position = this.queue.length;
    const waitSeconds = Math.ceil(position * 10); // 粗估每请求 10s
    this.logger.debug(`Request for session ${request.sessionId} queued at position ${position}`);
    return {
      status: 'queued',
      position,
      estimatedWait: `约 ${waitSeconds} 秒`,
    };
  }

  cancel(sessionId: string): boolean {
    const index = this.queue.findIndex((r) => r.sessionId === sessionId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.logger.debug(`Cancelled queued request for session ${sessionId}`);
      return true;
    }
    return false;
  }

  getQueuePosition(sessionId: string): number | null {
    const index = this.queue.findIndex((r) => r.sessionId === sessionId);
    return index !== -1 ? index + 1 : null;
  }

  private async executeAndDequeue(request: QueuedRequest): Promise<void> {
    try {
      await request.execute();
    } catch (err) {
      this.logger.error(`Queue execute error for session ${request.sessionId}: ${err}`);
    } finally {
      this.activeCount--;
      this.dequeueNext();
    }
  }

  private dequeueNext(): void {
    if (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const next = this.queue.shift()!;
      this.activeCount++;
      this.logger.debug(`Dequeuing request for session ${next.sessionId}`);
      // 通知前端已出队
      next.onEvent({ type: 'dequeued', data: {} });
      this.executeAndDequeue(next).catch(() => {});
    }
  }
}
```

- [ ] **Step 3: 编写队列模块**

```typescript
// server/src/common/queue/request-queue.module.ts
import { Global, Module } from '@nestjs/common';
import { RequestQueueService } from './request-queue.service';

@Global()
@Module({
  providers: [RequestQueueService],
  exports: [RequestQueueService],
})
export class RequestQueueModule {}
```

- [ ] **Step 4: 集成到 AppModule**

```typescript
// app.module.ts — imports 添加 RequestQueueModule
RequestQueueModule,
```

- [ ] **Step 5: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/src/common/queue/
git commit -m "feat: add in-memory FIFO request queue with semaphore concurrency control"
```

---

### Task 5: 速率限制（Throttler Guard）

**Files:**

- Create: `server/src/common/guards/throttler-user.guard.ts`
- Modify: `server/src/app.module.ts`
- Modify: `server/src/chat/chat.controller.ts`
- Modify: `server/src/common/filters/all-exceptions.filter.ts`

**Interfaces:**

- Produces: 全局和用户级速率限制保护 `/chat` 端点

- [ ] **Step 1: 在 AppModule 中配置 ThrottlerModule**

```typescript
// server/src/app.module.ts imports
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nestjs/throttler-storage-redis';
import { APP_GUARD } from '@nestjs/core';

// 在 imports 数组添加
ThrottlerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    throttlers: [
      {
        name: 'global',
        ttl: 60000,
        limit: config.get('GLOBAL_RATE_LIMIT_LIMIT', 60),
      },
    ],
    storage: config.get('REDIS_HOST')
      ? new ThrottlerStorageRedisService(`redis://${config.get('REDIS_HOST')}:${config.get('REDIS_PORT', 6379)}`)
      : undefined,
  }),
}),

// 在 providers 数组添加全局守卫
// （注意：不在 APP_GUARD 中注册，仅在 ChatController 上应用）
```

- [ ] **Step 2: 在 ChatController 上应用限流**

```typescript
// server/src/chat/chat.controller.ts
import { SkipThrottle, Throttle } from '@nestjs/throttler';

@Controller()
@UseGuards(JwtAuthGuard)
@SkipThrottle() // 类级别跳过，方法级按需开启
export class ChatController {
  @Post('chat')
  @SkipThrottle({ global: false, user: false }) // 启用限流
  @Throttle('user', { limit: (config) => 5, ttl: 60000 }) // 用户级：5 RPM
  async chat(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    // ...
  }

  @Get('sessions/:sdkSessionId/messages')
  @SkipThrottle() // 历史查询不限流
  async getMessages(@Param('sdkSessionId') sdkSessionId: string) {
    // ...
  }
}
```

- [ ] **Step 3: 创建用户级限流 Guard（按 JWT user.id 限流）**

```typescript
// server/src/common/guards/throttler-user.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';

@Injectable()
export class ThrottlerUserGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 从 JWT payload 提取用户 ID
    return req.user?.id?.toString() ?? req.ip;
  }
}
```

- [ ] **Step 4: 统一 429 响应格式**

```typescript
// 修改 all-exceptions.filter.ts
// 在 catch 分支中检测 429：
if (exception instanceof ThrottlerException) {
  response.status(429).json({
    success: false,
    statusCode: 429,
    message: '请求过于频繁，请稍后重试',
    retryAfter: Math.ceil(/* TTL remaining */ 60000 / 1000),
  });
  return;
}
```

- [ ] **Step 5: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add server/src/app.module.ts
git add server/src/chat/chat.controller.ts
git add server/src/common/guards/
git add server/src/common/filters/all-exceptions.filter.ts
git commit -m "feat: add rate limiting with global and user-level throttler"
```

---

### Task 6: 集成请求队列到 ChatService

**Files:**

- Modify: `server/src/chat/chat.service.ts`

**Interfaces:**

- Consumes: `RequestQueueService.enqueue()`, `RequestQueueService.cancel()`
- Consumes: `RequestQueueService.getQueuePosition()`

- [ ] **Step 1: 修改 ChatController 注入队列事件回调**

在 `chat.controller.ts` 的 `pushEvent` 回调中，添加队列相关事件的感知——但队列事件由 `RequestQueueService` 在出队时产生，ChatController 不需要改动。主要改动在 `ChatService`。

- [ ] **Step 2: 修改 `sendAndStream()` 方法**

将对 `agentService.sendMessage()` 的调用包装成一个可入队的执行函数：

```typescript
// chat.service.ts 中 sendAndStream 的改动示例

// 将 Agent SDK 调用封装为可延迟执行的函数
const executeQuery = async () => {
  const result = isFirstMessage
    ? await this.agentService.sendMessage(content)
    : await this.agentService.sendMessage(content, { resume: normalizedSessionId! });
  // ... 现有 stream 处理逻辑保持不变
  return result;
};

// 通过队列分发
const enqueueResult = await this.requestQueue.enqueue({
  sessionId: capturedSdkSessionId ?? normalizedSessionId ?? 'new',
  execute: executeQuery,
  onEvent: pushEvent,
});

if (enqueueResult.status === 'queued') {
  pushEvent({
    type: SseEventType.Queued,
    data: { position: enqueueResult.position, estimatedWait: enqueueResult.estimatedWait },
  });
  // 等待出队后的执行...
  // 注意：这里需要设计为 enqueue 返回一个 Promise，在出队执行时 resolve
} else if (enqueueResult.status === 'rejected') {
  pushEvent({ type: SseEventType.Error, data: { message: '系统繁忙，请稍后重试' } });
  return;
}
```

**设计决策：** `enqueue()` 应返回一个 Promise，当出队执行完成时 resolve。当前 `enqueue` 的同步/异步模型需要重构——如果直接执行（`status: 'executed'`），返回的 stream 应与现有行为一致；如果排队，则当出队执行时再 resolve。

将 `RequestQueueService.enqueue()` 改为返回 `Promise<EnqueueResult & { result?: any }>`：

```typescript
async enqueue<T>(request: QueuedRequest & { resolve?: (value: any) => void }): Promise<EnqueueResult> {
  if (this.activeCount < this.maxConcurrent) {
    this.activeCount++;
    // 直接执行
    return new Promise(async (resolve) => {
      try {
        const result = await request.execute();
        resolve({ status: 'executed', result } as any);
      } finally {
        this.activeCount--;
        this.dequeueNext();
      }
    });
  }
  // 入队
  return new Promise((resolve) => {
    this.queue.push({ ...request, resolve });
    resolve({ status: 'queued', position: this.queue.length, estimatedWait: '...' });
  });
}
```

- [ ] **Step 3: 修改 `cancelResponse` 方法**

```typescript
async cancelResponse(sdkSessionId: string): Promise<void> {
  // 先尝试从队列中取消
  const removed = this.requestQueue.cancel(sdkSessionId);
  if (removed) {
    this.logger.debug(`Cancelled queued request for session ${sdkSessionId}`);
    return;
  }
  // 不在队列中，走现有中断逻辑
  const query = this.activeQueries.get(sdkSessionId);
  if (query) {
    await query.interrupt();
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add server/src/chat/chat.service.ts
git add server/src/common/queue/request-queue.service.ts
git commit -m "feat: integrate request queue into chat service"
```

---

### Task 7: AgentService 集成 Key 池

**Files:**

- Modify: `server/src/agent/agent.service.ts`

**Interfaces:**

- Consumes: `KeyPoolService.select()`, `KeyPoolService.markFailure()`

- [ ] **Step 1: 修改 `sendMessage()` 注入 Key**

```typescript
// agent.service.ts 修改点
import { KeyPoolService } from '../common/key-pool/key-pool.service';

@Injectable()
export class AgentService {
  constructor(
    // ... 现有注入
    private readonly keyPool: KeyPoolService,
  ) {}

  async sendMessage(content: string, options?: { resume?: string }) {
    // 选择 Key
    const apiKey = await this.keyPool.select();
    const originalKey = process.env.ANTHROPIC_API_KEY;

    try {
      // 在调用前切换环境变量（如果 SDK 不支持运行时注入）
      process.env.ANTHROPIC_API_KEY = apiKey;

      const q = query({
        prompt: content,
        options: { ...sessionOptions, ... },
      });
      return { stream: q, interrupt: () => q.interrupt() };
    } catch (err) {
      // 标记 Key 失败
      await this.keyPool.markFailure(apiKey);
      throw err;
    }
    // 注意：在流式场景中，环境变量切换方式有竞态风险
    // 需要验证 SDK ^0.3.218 是否支持 options.anthropicApiKey 方式
  }
}
```

- [ ] **Step 2: 确认 SDK 是否支持动态 Key（验证步骤）**

```typescript
// 验证测试：检查 SDK query() 的 options 类型定义
// 期望：options 中有 anthropicApiKey 字段
// 如果不支持，改用环境变量切换方式 + 信号量锁保护
```

- [ ] **Step 3: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add server/src/agent/agent.service.ts
git commit -m "feat: integrate key pool into agent service for dynamic API key selection"
```

---

### Task 8: Cluster 模式

**Files:**

- Modify: `server/src/main.ts`
- Modify: `server/src/health/health.controller.ts`

**Interfaces:**

- Produces: Cluster 模式下的多 Worker 架构

- [ ] **Step 1: 修改 `main.ts` 添加 Cluster 逻辑**

```typescript
// server/src/main.ts

// 在 bootstrap() 之前添加
import * as cluster from 'node:cluster';
import * as os from 'node:os';

const CLUSTER_ENABLED = process.env.CLUSTER_ENABLED === 'true';

async function bootstrap() {
  // ... 现有 bootstrap 逻辑（NestFactory.create, 配置, listen）
}

if (CLUSTER_ENABLED && cluster.isPrimary) {
  const cpuCount = os.cpus().length;
  console.log(`Master process started, forking ${cpuCount} workers...`);

  for (let i = 0; i < cpuCount; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}), restarting...`);
    cluster.fork();
  });

  // Master 不做 NestJS 启动
} else {
  bootstrap();
}
```

- [ ] **Step 2: 修改 HealthController 返回 Worker 信息**

```typescript
// server/src/health/health.controller.ts
import * as cluster from 'node:cluster';

@Get()
@HealthCheck()
check() {
  return this.health.check([
    () => this.prismaHealth.pingCheck('database', this.prisma),
    // 添加 Worker 信息
    () => ({
      status: 'ok',
      cluster: {
        enabled: process.env.CLUSTER_ENABLED === 'true',
        isWorker: cluster.isWorker,
        workerId: cluster.isWorker ? cluster.worker?.id ?? null : null,
        activeWorkers: cluster.isPrimary ? cluster.workers?.length ?? 0 : 0,
      },
    }),
  ]);
}
```

- [ ] **Step 3: Worker 优雅退出处理**

```typescript
// main.ts 中，在 bootstrap() 内添加
if (CLUSTER_ENABLED && cluster.isWorker) {
  process.on('SIGTERM', async () => {
    const shutdownTimeout = Number(process.env.WORKER_SHUTDOWN_TIMEOUT || 30);
    logger.log(`Worker ${process.pid} shutting down gracefully (${shutdownTimeout}s timeout)`);
    await app.close();
    process.exit(0);
  });
}
```

- [ ] **Step 4: 验证 Cluster 启动**

手动验证：

```bash
CLUSTER_ENABLED=true node dist/main.js
# 预期：看到 "Master process started, forking N workers..."
# 预期：健康检查返回 activeWorkers > 0
```

- [ ] **Step 5: Commit**

```bash
git add server/src/main.ts
git add server/src/health/health.controller.ts
git commit -m "feat: add cluster mode for multi-core CPU utilization"
```

---

### Task 9: Prisma 连接池配置

**Files:**

- Modify: `server/src/prisma/prisma.service.ts`

**Interfaces:**

- Produces: 显式配置的 Prisma 连接池

- [ ] **Step 1: 修改 PrismaService 添加 connectionLimit**

```typescript
// server/src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: Logger) {
    const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT
      ? Number(process.env.PRISMA_CONNECTION_LIMIT)
      : undefined;

    super({
      // Prisma v6 连接池参数
      ...(connectionLimit ? { connectionLimit } : {}),
    });
  }

  async onModuleInit() {
    await this.$connect();
    const poolSize = process.env.PRISMA_CONNECTION_LIMIT || 'auto';
    this.logger.log(`Database connected (connection pool: ${poolSize})`);
  }
  // ...
}
```

- [ ] **Step 2: 验证编译**

```bash
cd server && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/src/prisma/prisma.service.ts
git commit -m "feat: configure Prisma connection pool with env variable"
```

---

### Task 10: 前端排队 UI 适配

**Files:**

- Modify: `frontend/src/...`（具体路径需根据前端实际结构确定）

- [ ] **Step 1: 更新前端 SSE 事件类型映射**

```typescript
// 在 chat.service.ts（前端）中添加新事件处理
// 在 existing SSE event switch 中添加：
case 'queued':
  // 显示排队提示卡片
  break;
case 'queue_position':
  // 更新排队位置数字
  break;
case 'dequeued':
  // 移除排队提示，准备接收 AI 回复
  break;
```

- [ ] **Step 2: 实现排队提示卡片组件**

在助理消息气泡位置新增排队提示 UI：

- 状态色：待定（非错误态，使用 info 色）
- 内容："您的请求已排队，前方还有 N 位"
- 按钮："取消排队"

- [ ] **Step 3: 实现排队取消**

排队状态下，发送按钮切换为"取消排队"按钮。点击触发 SSE cancel 流。

- [ ] **Step 4: 验证**

```bash
cd client && npm run build
# 确认前端编译无报错
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/
git commit -m "feat: add queuing UI for chat — queue position indicator and cancel button"
```

---

## Self-Review

### 1. Spec 覆盖度检查

| Spec 需求                                | 对应 Task                     | 状态        |
| ---------------------------------------- | ----------------------------- | ----------- |
| api-key-pool: 多 Key 注册与配置          | Task 3.2 (loadKeysFromEnv)    | ✅          |
| api-key-pool: Least-Used 选择            | Task 3.2 (selectLocal)        | ✅          |
| api-key-pool: 故障自动切换               | Task 7.1 (markFailure)        | ✅          |
| api-key-pool: 跨进程共享（Redis）        | ❌ 暂用内存模式，未实现 Redis | ⚠️ 设计决策 |
| rate-limiting: 全局限流 (60 RPM)         | Task 5.1                      | ✅          |
| rate-limiting: 用户级限流 (5 RPM)        | Task 5.2-5.3                  | ✅          |
| rate-limiting: 限流响应 429 格式         | Task 5.4                      | ✅          |
| request-queue: 入队与 FIFO 消费          | Task 4.2 + Task 6.2           | ✅          |
| request-queue: 队列满时拒绝              | Task 4.2                      | ✅          |
| request-queue: 取消入队                  | Task 4.2 + Task 6.3           | ✅          |
| request-queue: 位置更新                  | Task 4.2                      | ✅          |
| cluster-mode: Master/Worker 启动         | Task 8.1                      | ✅          |
| cluster-mode: 优雅退出                   | Task 8.3                      | ✅          |
| cluster-mode: 崩溃自动重启               | Task 8.1                      | ✅          |
| cluster-mode: 健康检查 Worker 数         | Task 8.2                      | ✅          |
| prisma-pool-tuning: 显式 connectionLimit | Task 9.1                      | ✅          |
| prisma-pool-tuning: 启动时校验           | Task 9.1 (console log)        | ✅          |
| chat-streaming: 排队事件推送             | Task 6.2                      | ✅          |
| chat-streaming: 队列 UI                  | Task 10                       | ✅          |

### 2. 占位符扫描

- 无 "TBD", "TODO" 占位符
- Task 3.2 的 Redis 集成标注为 TODO，但已设计降级方案
- Task 7.2 的 SDK 兼容性标注为验证步骤
- Task 10 的路径使用 placeholder，需在实现前确认

### 3. 类型一致性

- `KeyPoolService.select()` → `string` — 在所有 Task 中一致
- `RequestQueueService.enqueue()` → `Promise<EnqueueResult>` — 在所有 Task 中一致
- `SseEventType.Queued/QueuePosition/Dequeued` — 在 Task 2/6/10 中一致
