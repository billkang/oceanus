# 轮次与预算上限管控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Oceanus 的 AI 调用增加轮次上限（`AGENT_MAX_TURNS` 默认 15）与单次预算硬顶（`AGENT_MAX_BUDGET_USD` 默认 1.00），命中限额时以专用 SSE 事件通知、流受控完成、用户可 resume 继续聊。

**Architecture:** `AgentService` 负责配置解析（无效值回退默认，永不无限）并注入 SDK 的 `maxTurns`/`maxBudgetUsd`；`ChatService` 在流循环内检测 SDK 限额错误子类型，发专用 SSE 事件 + 置 `limitHit` 标志后受控关闭流；前端展示内联横幅并保持输入可用。

**Tech Stack:** NestJS 11 / Prisma 6 / Claude Agent SDK v0.3.218 / Angular 21 / PrimeNG 21 / Tailwind 4 / vitest（后端）/ Karma-Jasmine（前端）

## Global Constraints

- `AGENT_MAX_TURNS` 默认 **15**，`AGENT_MAX_BUDGET_USD` 默认 **1.00**（单次 query 独立判定）
- 空 / 非数字 / `0` / 负数一律回退默认，**永不进入无限状态**
- SSE 事件 snake_case：`turn_limit_reached` / `budget_limit_reached`，data 统一 `{ limit: number }`
- 命中限额 → 会话保持 `active`，用户可 resume（新 query 重新计轮次/预算）
- 命中限额 → 跳过 `afterStreamComplete`（标题/PRD）与 `recordGeneration`，仍 `flushTrace` + 发 `stream_complete`
- 其他错误子类型（`error_during_execution` 等）→ 保持现状走通用 `error` 事件
- 代码注释正文用中文；专有名词（SDK、SSE、Signal）保留英文

---

### Task 1: SSE 事件类型定义（后端）

**Files:**

- Modify: `server/src/agent/types/sse-events.ts`

**Interfaces:**

- Produces: `SseEventType.TurnLimitReached`（`'turn_limit_reached'`）、`SseEventType.BudgetLimitReached`（`'budget_limit_reached'`）；`SseTurnLimitReached` / `SseBudgetLimitReached`（data `{ limit: number }`）；二者已加入 `SseEvent` 联合

纯类型变更，无需单测（`pnpm typecheck` / `pnpm build` 验证）。

- [ ] **Step 1: 新增枚举值**

在 `server/src/agent/types/sse-events.ts` 的枚举末尾（`Dequeued = 'dequeued'` 之后）新增：

```typescript
  TurnLimitReached = 'turn_limit_reached',
  BudgetLimitReached = 'budget_limit_reached',
```

- [ ] **Step 2: 新增事件接口**

在 `SseDequeued` 接口之后新增：

```typescript
/** SSE 事件 — 已达轮次上限 */
export interface SseTurnLimitReached {
  type: SseEventType.TurnLimitReached;
  data: { limit: number };
}

/** SSE 事件 — 已达预算上限 */
export interface SseBudgetLimitReached {
  type: SseEventType.BudgetLimitReached;
  data: { limit: number };
}
```

- [ ] **Step 3: 加入联合类型**

将 `SseEvent` 联合的成员追加（放在 `SseDequeued` 之后）：

```typescript
  | SseTurnLimitReached
  | SseBudgetLimitReached
```

- [ ] **Step 4: 验证 + 提交**

```bash
cd server && pnpm typecheck
git add server/src/agent/types/sse-events.ts
git commit -m "feat: 新增 turn_limit_reached / budget_limit_reached SSE 事件类型"
```

Expected: typecheck PASS。

---

### Task 2: 后端配置解析与注入

**Files:**

- Modify: `server/src/agent/agent.service.ts`

**Interfaces:**

- Consumes: 已有 `ConfigService`（注入为 `configService`）、已有 `Logger`（`this.logger`）
- Produces: `AgentService.DEFAULT_MAX_TURNS = 15`、`AgentService.DEFAULT_MAX_BUDGET_USD = 1.0`；私有 `parseLimit(raw, fallback): number`、`resolveAgentLimits(): { maxTurns; maxBudgetUsd }`；公开 `getAgentLimits(): { maxTurns; maxBudgetUsd }`

- [ ] **Step 1: 写失败测试**

在 `server/src/agent/agent.service.spec.ts` 的 `mockConfig` 处新增一个可返回任意键的配置工厂，并在 `describe('sendMessage')` 之前新增 `describe('getAgentLimits')`：

```typescript
// 可返回任意 env 键的配置工厂
const mockEnvConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as ConfigService;

describe('getAgentLimits', () => {
  it('未配置时应回退默认 15 / 1.00', () => {
    const service = new AgentService(mockLogger, mockEnvConfig({}), nullLangfuse, mockKeyPool as any);
    expect(service.getAgentLimits()).toEqual({ maxTurns: 15, maxBudgetUsd: 1.0 });
  });

  it('空值 / 非数字 / 0 / 负数应回退默认', () => {
    const config = mockEnvConfig({ AGENT_MAX_TURNS: 'abc', AGENT_MAX_BUDGET_USD: '0' });
    const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any);
    expect(service.getAgentLimits()).toEqual({ maxTurns: 15, maxBudgetUsd: 1.0 });
  });

  it('合法值应生效', () => {
    const config = mockEnvConfig({ AGENT_MAX_TURNS: '20', AGENT_MAX_BUDGET_USD: '2.5' });
    const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any);
    expect(service.getAgentLimits()).toEqual({ maxTurns: 20, maxBudgetUsd: 2.5 });
  });

  it('query options 应包含解析后的 maxTurns 与 maxBudgetUsd', async () => {
    const mockGenerate = (async function* () {
      yield {
        type: 'stream_event' as const,
        event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
      };
    })();
    vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

    const config = mockEnvConfig({ AGENT_MAX_TURNS: '20', AGENT_MAX_BUDGET_USD: '2.5' });
    const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any);
    await service.sendMessage('hello');

    const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
    expect(queryOptions?.maxTurns).toBe(20);
    expect(queryOptions?.maxBudgetUsd).toBe(2.5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && pnpm vitest run src/agent/agent.service.spec.ts
```

Expected: FAIL — `getAgentLimits is not a function`。

- [ ] **Step 3: 最小实现**

在 `server/src/agent/agent.service.ts` 的类体顶部（`private readonly available` 之前）新增常量，并在类内新增三个方法：

```typescript
  /** 轮次 / 预算上限默认值（无效配置一律回退） */
  private static readonly DEFAULT_MAX_TURNS = 15;
  private static readonly DEFAULT_MAX_BUDGET_USD = 1.0;
```

在 `isAvailable()` 方法之后新增：

```typescript
  /** 解析环境变量上限值：空 / 非数字 / 0 / 负数一律回退默认 */
  private parseLimit(raw: string | undefined, fallback: number): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** 解析生效的轮次 / 预算上限（每次 query 调用，全局默认） */
  private resolveAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
    return {
      maxTurns: this.parseLimit(
        this.configService.get<string>('AGENT_MAX_TURNS'),
        AgentService.DEFAULT_MAX_TURNS,
      ),
      maxBudgetUsd: this.parseLimit(
        this.configService.get<string>('AGENT_MAX_BUDGET_USD'),
        AgentService.DEFAULT_MAX_BUDGET_USD,
      ),
    };
  }

  /** 当前生效的轮次 / 预算上限（供 ChatService 命中限额时取 limit 值） */
  getAgentLimits(): { maxTurns: number; maxBudgetUsd: number } {
    return this.resolveAgentLimits();
  }
```

- [ ] **Step 4: 修改 query 选项（替换硬编码）**

在 `sendMessage` 的 `try` 块内、`const q = query({...})` 之前解析一次，并替换 `maxTurns: 20`：

```typescript
    try {
      const { maxTurns, maxBudgetUsd } = this.resolveAgentLimits();

      const q = query({
        prompt: content,
        options: {
          ...sessionOptions,
          sessionStore: this.sessionStore,
          includePartialMessages: true,
          agent: 'oceanus-tide',
          agents: {
            'oceanus-tide': {
              description: 'Oceanus 需求讨论助手',
              prompt: `你是 Oceanus 需求讨论助手，运行在 Oceanus AI 协作平台（网页版）。
...
              tools: ['Skill', 'Read', 'Write', 'Bash', 'Grep', 'Glob', 'Edit', 'WebSearch', 'WebFetch'],
            },
          },
          skills: 'all',
          settingSources: ['project'],
          model: 'claude-sonnet-5',
          effort: 'low',
          thinking: { type: 'enabled', budgetTokens: 4000 },
          maxTurns,
          maxBudgetUsd,
          ...this.buildLangfuseHooks(),
        },
      });
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm vitest run src/agent/agent.service.spec.ts
```

Expected: PASS（含新增 4 条 + 原有用例）。

- [ ] **Step 6: 提交**

```bash
git add server/src/agent/agent.service.ts server/src/agent/agent.service.spec.ts
git commit -m "feat: maxTurns 改由 env 驱动并新增 maxBudgetUsd 单次预算硬顶"
```

---

### Task 3: .env.example 配置项

**Files:**

- Modify: `server/.env.example`

配置变更，无需单测（`pnpm lint` 验证）。

- [ ] **Step 1: 新增配置项**

在 `# ── Claude Agent SDK ──` 段（`ANTHROPIC_SMALL_FAST_MODEL=claude-sonnet-5` 之后）新增：

```dotenv
# 单次 query 的轮次上限（空 / 非数字 / 0 回退默认 15）
AGENT_MAX_TURNS=15
# 单次 query 的预算硬顶（美元，SDK 客户端估算非账单；空 / 非数字 / 0 回退默认 1.00）
# 每次 query 独立判定，命中后用户可继续发送消息（新 query 重新计）
AGENT_MAX_BUDGET_USD=1.00
```

- [ ] **Step 2: 验证 + 提交**

```bash
cd server && pnpm lint
git add server/.env.example
git commit -m "docs: 新增 AGENT_MAX_TURNS / AGENT_MAX_BUDGET_USD 配置说明"
```

Expected: lint PASS。

---

### Task 4: 后端限额命中处理

**Files:**

- Modify: `server/src/chat/chat.service.ts`
- Test: `server/src/chat/chat.service.spec.ts`

**Interfaces:**

- Consumes: `AgentService.getAgentLimits()`（Task 2）、`SseEventType.TurnLimitReached` / `SseEventType.BudgetLimitReached`（Task 1）、SDK 类型 `SDKResultError`
- Produces: `executeStream` 内的局部 `limitHit: 'turns' | 'budget' | null`；限额命中时发出 `{ type: 'turn_limit_reached'|'budget_limit_reached', data: { limit } }`

- [ ] **Step 1: 写失败测试**

在 `server/src/chat/chat.service.spec.ts` 的 `mockAgentService` 中新增 `getAgentLimits`：

```typescript
const mockAgentService = {
  sendMessage: vi.fn(),
  getSessionMessages: vi.fn(),
  getAgentLimits: vi.fn().mockReturnValue({ maxTurns: 15, maxBudgetUsd: 1.0 }),
};
```

在 `describe('sendAndStream — SDK 事件映射')` 之后新增 `describe('sendAndStream — 限额命中')`：

```typescript
describe('sendAndStream — 限额命中', () => {
  const SDK_SESSION_ID = 'sdk-uuid-limit';

  beforeEach(() => {
    mockSessionService.getBySdkSessionId.mockResolvedValue({
      id: 1,
      sdkSessionId: SDK_SESSION_ID,
      title: '新会话',
      projectId: 1,
    });
  });

  it('达到轮次上限应发 turn_limit_reached 且不重复发 error', async () => {
    const mockGen = (async function* () {
      yield {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        num_turns: 15,
        total_cost_usd: 0.8,
        usage: {},
        errors: ['Reached maximum number of turns'],
      } as any;
    })();
    mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

    const events: any[] = [];
    await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

    const limitEvent = events.find((e) => e.type === 'turn_limit_reached');
    expect(limitEvent).toBeDefined();
    expect(limitEvent.data).toEqual({ limit: 15 });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'stream_complete')).toBe(true);
  });

  it('达到预算上限应发 budget_limit_reached 且 data 携带 limit', async () => {
    const mockGen = (async function* () {
      yield {
        type: 'result',
        subtype: 'error_max_budget_usd',
        is_error: true,
        num_turns: 9,
        total_cost_usd: 1.0,
        usage: {},
        errors: ['Reached maximum budget of $1.00'],
      } as any;
    })();
    mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

    const events: any[] = [];
    await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: (e) => events.push(e) });

    const limitEvent = events.find((e) => e.type === 'budget_limit_reached');
    expect(limitEvent).toBeDefined();
    expect(limitEvent.data).toEqual({ limit: 1.0 });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('限额命中应跳过标题更新与 PRD 提取，仍 flush trace 并记日志', async () => {
    const mockGen = (async function* () {
      yield {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        num_turns: 15,
        total_cost_usd: 0.8,
        usage: {},
        errors: ['Reached maximum number of turns'],
      } as any;
    })();
    mockAgentService.sendMessage.mockResolvedValue(mockQueryResult(mockGen));

    await service.sendAndStream({ content: 'hi', sdkSessionId: SDK_SESSION_ID, onEvent: vi.fn() });

    expect(mockSessionService.updateTitle).not.toHaveBeenCalled();
    expect(mockAssetService.create).not.toHaveBeenCalled();
    expect(mockLangfuseService.recordGeneration).not.toHaveBeenCalled();
    expect(mockLangfuseService.flushTrace).toHaveBeenCalled();
    expect(mockSessionLogService.log).toHaveBeenCalledWith(
      'default',
      SDK_SESSION_ID,
      'Turn limit reached',
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd server && pnpm vitest run src/chat/chat.service.spec.ts
```

Expected: FAIL — 未发出 `turn_limit_reached`（现有逻辑只处理 success 子类型）。

- [ ] **Step 3: 最小实现**

在 `server/src/chat/chat.service.ts` 的 SDK import 中加入 `SDKResultError`：

```typescript
import type {
  SDKMessage,
  SDKPromptSuggestionMessage,
  SDKResultError,
  SDKResultSuccess,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';
```

在 `executeStream` 内（`let tokenUsage` 之后）新增局部标志：

```typescript
let tokenUsage: { inputTokens?: number; outputTokens?: number } | undefined;
/** 限额命中标志：'turns' | 'budget' | null */
let limitHit: 'turns' | 'budget' | null = null;
```

在现有 success 分支之后、`mapSdkMessageToSseEvents` 调用之前，新增限额错误分支：

```typescript
// 命中轮次 / 预算上限：发专用事件 + 记录日志 + 置 flag 后受控结束
if (msg.type === 'result') {
  const resultMsg = msg as SDKResultError;
  if (resultMsg.subtype === 'error_max_turns' || resultMsg.subtype === 'error_max_budget_usd') {
    const isTurnLimit = resultMsg.subtype === 'error_max_turns';
    const limits = this.agentService.getAgentLimits();
    const limit = isTurnLimit ? limits.maxTurns : limits.maxBudgetUsd;

    onEvent({
      type: isTurnLimit ? SseEventType.TurnLimitReached : SseEventType.BudgetLimitReached,
      data: { limit },
    });

    if (capturedSdkSessionId) {
      this.sessionLogService.log(
        'default',
        capturedSdkSessionId,
        isTurnLimit ? 'Turn limit reached' : 'Budget limit reached',
        { limit },
      );
    }

    limitHit = isTurnLimit ? 'turns' : 'budget';
    break;
  }
}
```

- [ ] **Step 4: 修改 post-loop 与 catch**

将循环后的 `if (responseText.trim().length > 0) { recordGeneration }` 与 `afterStreamComplete` 改为受 `limitHit` 保护，并在 catch 顶部加抑制：

```typescript
        const finalSessionId = capturedSdkSessionId;
        if (finalSessionId) {
          const round = (this.messageRoundCount.get(finalSessionId) ?? 0) + 1;
          this.messageRoundCount.set(finalSessionId, round);

          if (!limitHit && responseText.trim().length > 0) {
            this.langfuseService.recordGeneration(finalSessionId, content, responseText, tokenUsage);
          }

          await this.langfuseService.flushTrace(finalSessionId);

          if (!limitHit) {
            await this.afterStreamComplete(finalSessionId, onEvent, responseText);
          }
        }

        onEvent({ type: SseEventType.StreamComplete, data: {} });
      } catch (error) {
        // 限额命中已发专用事件（或已在循环内 break），抑制通用 error 避免重复
        if (limitHit) return;
        const errMsg = (error as Error).message;
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm vitest run src/chat/chat.service.spec.ts
```

Expected: PASS（含新增 3 条 + 原有用例）。

- [ ] **Step 6: 提交**

```bash
git add server/src/chat/chat.service.ts server/src/chat/chat.service.spec.ts
git commit -m "feat: 限额命中改为专用 SSE 事件并受控完成，跳过标题/PRD 后处理"
```

---

### Task 5: 前端 SSE 枚举与事件处理

**Files:**

- Modify: `client/src/app/chat/chat.service.ts`（镜像枚举）
- Modify: `client/src/app/chat/chat.component.ts`（`limitNotice` 信号 + case + 数据接口）
- Test: `client/src/app/chat/chat.component.spec.ts`

**Interfaces:**

- Consumes: 后端 SSE 事件名 `turn_limit_reached` / `budget_limit_reached`
- Produces: `ChatComponent.limitNotice: Signal<string>`；`send()` 时清空横幅

- [ ] **Step 1: 写失败测试**

在 `client/src/app/chat/chat.component.spec.ts` 的 `describe` 内新增：

```typescript
it('收到 turn_limit_reached 事件应显示轮次上限横幅', () => {
  (
    component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
  ).handleSseEvent({ type: 'turn_limit_reached', data: { limit: 15 } });
  fixture.detectChanges();
  expect(component.limitNotice()).toContain('15');
});

it('收到 budget_limit_reached 事件应显示预算上限横幅', () => {
  (
    component as unknown as { handleSseEvent: (e: { type: string; data: Record<string, unknown> }) => void }
  ).handleSseEvent({ type: 'budget_limit_reached', data: { limit: 1 } });
  fixture.detectChanges();
  expect(component.limitNotice()).toContain('1.00');
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd client && pnpm test
```

Expected: FAIL — `component.limitNotice is not a function`。

- [ ] **Step 3: 镜像枚举 + 数据接口 + 信号 + case**

在 `client/src/app/chat/chat.service.ts` 的 `SseEventType` 枚举末尾新增：

```typescript
  TurnLimitReached = 'turn_limit_reached',
  BudgetLimitReached = 'budget_limit_reached',
```

在 `client/src/app/chat/chat.component.ts` 的 SSE 数据类型接口区新增：

```typescript
interface TurnLimitReachedData {
  limit: number;
}
interface BudgetLimitReachedData {
  limit: number;
}
```

在信号声明区（`estimatedWait` 之后）新增：

```typescript
  /** 限额命中提示（内联横幅文案，下次发送清空） */
  readonly limitNotice = signal('');
```

在 `handleSseEvent` 的 `case SseEventType.Dequeued` 之后、`default` 之前新增：

```typescript
      case SseEventType.TurnLimitReached:
        this.limitNotice.set(
          `已达到本次轮次上限（${(event.data as unknown as TurnLimitReachedData).limit} 轮），你可以继续发送消息`,
        );
        break;

      case SseEventType.BudgetLimitReached:
        this.limitNotice.set(
          `已达到本次预算上限（$${(event.data as unknown as BudgetLimitReachedData).limit.toFixed(2)}），你可以继续发送消息`,
        );
        break;
```

在 `send()` 方法顶部（`const text = this.chatModel().message.trim(); if (!text) return;` 之后）清空横幅：

```typescript
this.limitNotice.set('');
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd client && pnpm test
```

Expected: PASS（新增 2 条 + 原有用例）。

- [ ] **Step 5: 提交**

```bash
git add client/src/app/chat/chat.service.ts client/src/app/chat/chat.component.ts client/src/app/chat/chat.component.spec.ts
git commit -m "feat: 前端展示轮次/预算上限内联横幅，输入保持可用"
```

---

### Task 6: 前端横幅模板

**Files:**

- Modify: `client/src/app/chat/chat.component.html`

模板变更，`pnpm build` 验证。

- [ ] **Step 1: 渲染横幅**

在输入区（`<div class="relative border-t ...">` 内，`<div class="max-w-3xl mx-auto">` 之前）新增：

```html
<!-- 限额命中提示横幅 -->
@if (limitNotice()) {
<div class="max-w-3xl mx-auto mb-2">
  <div class="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
    <span class="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></span>
    <span>{{ limitNotice() }}</span>
  </div>
</div>
}
```

- [ ] **Step 2: 验证 + 提交**

```bash
cd client && pnpm build
git add client/src/app/chat/chat.component.html
git commit -m "feat: 输入区渲染限额命中内联横幅"
```

Expected: build PASS。

---

### Task 7: 文档同步

**Files:**

- Modify: `docs/1-getting-started/` 下 env 配置说明文档
- Create: `docs/2-architecture/decisions/ADR-012-turn-budget-limits.md`

文档变更，无单测（`git diff --check` 验证）。

- [ ] **Step 1: 更新 env 配置说明**

在 `docs/1-getting-started/` 下定位 env 配置说明文档（如 `environment.md` / `configuration.md`），在 AI/Agent 配置段补充：

```markdown
| 变量                   | 默认   | 说明                                                                        |
| ---------------------- | ------ | --------------------------------------------------------------------------- |
| `AGENT_MAX_TURNS`      | `15`   | 单次 query 轮次上限；空 / 非数字 / 0 回退默认                               |
| `AGENT_MAX_BUDGET_USD` | `1.00` | 单次 query 预算硬顶（美元，SDK 客户端估算非账单）；命中后用户可继续发送消息 |
```

- [ ] **Step 2: 新建 ADR-012**

创建 `docs/2-architecture/decisions/ADR-012-turn-budget-limits.md`：

```markdown
# ADR-012: 轮次与预算上限管控

- **日期**: 2026-08-01
- **状态**: 已接受
- **关联**: ADR-008（会话连续性）

## 背景

AI 调用硬编码 `maxTurns: 20` 且无成本上限，循环失控时单次调用成本不可控。

## 决策

1. 全局默认 env 配置 `AGENT_MAX_TURNS`（默认 15）/ `AGENT_MAX_BUDGET_USD`（默认 1.00），不做会话级/用户级可配
2. 预算语义为单次硬顶（SDK 原生 `maxBudgetUsd`），每次 query 独立判定；resume = 新 query = 重新计
3. 无效配置值一律回退默认，永不进入无限状态
4. 命中限额发专用 SSE 事件 `turn_limit_reached` / `budget_limit_reached`（data 携带 limit），流受控完成，会话保持 active
5. 限额命中跳过标题更新/PRD 提取与 `recordGeneration`，仍 `flushTrace`

## 权衡

- 默认值松紧依赖模型定价与工具调用密度，需按使用数据回调（env 一行可调）
- `total_cost_usd` 为客户端估算，非权威账单
- 不做累计预算、成本落库、计费（见 proposal Out of Scope）
```

- [ ] **Step 3: 验证 + 提交**

```bash
git add docs/1-getting-started/ docs/2-architecture/decisions/ADR-012-turn-budget-limits.md
git commit -m "docs: 补充 AGENT_MAX_TURNS/BUDGET 配置说明并新增 ADR-012"
```

---

## Self-Review

**1. Spec 覆盖度**

- `agent-budget-limits` 全部 6 个需求：全局配置（Task 2/3）、SDK 注入（Task 2）、限额通知（Task 4）、流处理（Task 4）、可观测性（Task 4）、前端提示（Task 5/6）✅
- `agent-integration` MODIFIED（`oceanus-tide` 配置含 env 驱动的 maxTurns + maxBudgetUsd）：Task 2 ✅
- ADR：Task 7 ✅

**2. Placeholder 扫描**：无 TBD/TODO；每步含真实代码与测试命令。

**3. 类型一致性**

- `getAgentLimits()` 在 Task 2 定义（返回 `{ maxTurns: number; maxBudgetUsd: number }`），Task 4 消费同一签名 ✅
- SSE 事件名/枚举：Task 1 定义 `turn_limit_reached` / `budget_limit_reached`，Task 4 后端发出、Task 5 前端消费，一致 ✅
- `limitHit` 标志在 Task 4 中一致使用（循环内设置 / post-loop 与 catch 检查）✅
- `limitNotice` 信号 Task 5 定义、Task 6 模板消费 ✅
