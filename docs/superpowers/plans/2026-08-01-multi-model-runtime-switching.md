# 多模型注册与运行时切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Oceanus 通过 `server/config/models.yaml` 配置多个 LLM provider（DeepSeek/Kimi），用户在前端手动选模型，每次 `query()` 按所选 provider 逐调用注入 `model` + `env`。

**Architecture:** 新增 `ModelRegistryService` 统一加载/校验/解析 provider 配置；`AgentService.sendMessage` 改为从注册表解析 provider 并注入 `env`（合并 `process.env` + provider 覆盖），删除全局 `process.env` 突变；`POST /chat` 透传可选 `model` 参数（message/confirm 均可）；`GET /models` 暴露可用模型；前端 `p-dropdown` 仅多模型时渲染。

**Tech Stack:** NestJS 11（ConfigService / @nestjs/swagger / class-validator）、`yaml`（新增依赖）、Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）、Angular 21 + PrimeNG `p-dropdown`、vitest / ng test。

## Global Constraints

- `models.yaml` 必填字段：`displayName` / `baseUrl` / `modelId` / `smallFastModel` /（`apiKeyEnv` 或 `keyPool` 二选一）；缺一该 provider 非法
- 默认 provider：`default` 声明优先，缺省回退第一个有效 provider 并 WARN
- 默认 provider Key 不可用（`keyPool` 池空 或 `apiKeyEnv` 缺失）→ 整体 `available=false`，不静默回退
- 未知/不可用 `model` 参数 → 400，错误信息含可用模型列表
- `GET /models` 响应只含 `{ name, displayName, default }`，不含任何 Key/`baseUrl`
- 注入方式固定为 `env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_SMALL_FAST_MODEL }` + `model: provider.modelId`
- 全局 `ANTHROPIC_API_KEY` 不再被 Agent 调用与 KeyPool 读取（breaking）
- 所有 SDD 文档正文中文；提交信息描述性中文 message
- 后端测试命令：`cd server && pnpm test`（vitest run）；前端：`cd client && pnpm test`（ng test --watch=false）

---

### Task 1: 模型注册表基础设施（types + service + module + 配置文件）

**Files:**
- Modify: `server/package.json`（新增 `yaml` 依赖）
- Create: `server/config/models.yaml`
- Create: `server/config/models.example.yaml`
- Create: `server/src/common/model-registry/model-registry.types.ts`
- Create: `server/src/common/model-registry/model-registry.service.ts`
- Create: `server/src/common/model-registry/model-registry.module.ts`
- Test: `server/src/common/model-registry/model-registry.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService`、`KeyPoolService`（@Global，可直接注入）
- Produces:
  - `ProviderConfig { displayName, baseUrl, modelId, smallFastModel, apiKeyEnv?, keyPool? }`
  - `ModelRegistryConfig { default?, models: Record<string, ProviderConfig> }`
  - `ResolvedProvider { name, displayName, baseUrl, modelId, smallFastModel, apiKey, keySource: 'pool' | 'env' }`
  - `ModelInfo { name, displayName, default }`
  - `ModelRegistryService.load(filePath?)`, `isAvailable(): boolean`, `resolveProvider(model?): ResolvedProvider`（未知抛 `BadRequestException`）, `listModels(): ModelInfo[]`

- [ ] **Step 1: 安装 yaml 依赖**

```bash
cd /Users/billkang/workspace/oceanus && pnpm --filter server add yaml
```

- [ ] **Step 2: 创建配置文件**

`server/config/models.example.yaml`：
```yaml
# 模型注册表示例 — 复制为 models.yaml 使用
default: deepseek
models:
  deepseek:
    displayName: DeepSeek
    baseUrl: https://api.deepseek.com/anthropic
    modelId: claude-sonnet-5        # DeepSeek Anthropic 端点当前接受的模型串（生产已验证）
    smallFastModel: deepseek-v4-flash
    keyPool: true                   # 复用 LLM_API_KEY_N 轮换
  kimi:
    displayName: Kimi K2
    baseUrl: https://api.moonshot.ai/anthropic
    modelId: kimi-k2.7-code
    smallFastModel: kimi-k2.5
    apiKeyEnv: KIMI_API_KEY         # 从环境变量读取 Key
```

`server/config/models.yaml`：复制上面的内容（deepseek 完整条目 + kimi 条目，`.gitignore` 时保留该文件；Key 由 env 提供）。

- [ ] **Step 3: 写失败的注册表服务测试**

`server/src/common/model-registry/model-registry.service.spec.ts`：
```typescript
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { KeyPoolService } from '../key-pool/key-pool.service';
import { ModelRegistryService } from './model-registry.service';
import { ResolvedProvider } from './model-registry.types';

describe('ModelRegistryService', () => {
  let service: ModelRegistryService;
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'model-reg-'));
  const writeYaml = (name: string, content: string) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const keyPool = { getKeyCount: () => 2, select: () => 'pool-key-1' } as unknown as KeyPoolService;
  const config = new ConfigService({ KIMI_API_KEY: 'kimi-key-1' });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: KeyPoolService, useValue: keyPool },
        ModelRegistryService,
      ],
    }).compile();
    service = moduleRef.get(ModelRegistryService);
  });

  const validYaml = `
default: deepseek
models:
  deepseek:
    displayName: DeepSeek
    baseUrl: https://api.deepseek.com/anthropic
    modelId: claude-sonnet-5
    smallFastModel: deepseek-v4-flash
    keyPool: true
  kimi:
    displayName: Kimi K2
    baseUrl: https://api.moonshot.ai/anthropic
    modelId: kimi-k2.7-code
    smallFastModel: kimi-k2.5
    apiKeyEnv: KIMI_API_KEY
`;

  it('正常加载并解析默认 provider', () => {
    service.load(writeYaml('a.yaml', validYaml));
    const provider = service.resolveProvider();
    expect(provider.name).toBe('deepseek');
    expect(provider.modelId).toBe('claude-sonnet-5');
    expect(provider.keySource).toBe('pool');
    expect(provider.apiKey).toBe('pool-key-1');
  });

  it('指定 kimi 时返回 kimi 配置（env Key）', () => {
    service.load(writeYaml('b.yaml', validYaml));
    const provider = service.resolveProvider('kimi');
    expect(provider.name).toBe('kimi');
    expect(provider.baseUrl).toContain('moonshot');
    expect(provider.apiKey).toBe('kimi-key-1');
    expect(provider.keySource).toBe('env');
  });

  it('未知模型抛 BadRequestException 且信息含可用列表', () => {
    service.load(writeYaml('c.yaml', validYaml));
    try {
      service.resolveProvider('unknown');
      fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as Error).message).toContain('deepseek');
      expect((e as Error).message).toContain('kimi');
    }
  });

  it('文件缺失 → isAvailable 为 false', () => {
    service.load('/nonexistent/models.yaml');
    expect(service.isAvailable()).toBe(false);
  });

  it('配置非法（缺必填字段）→ isAvailable 为 false', () => {
    service.load(writeYaml('d.yaml', 'models:\n  bad:\n    displayName: X\n'));
    expect(service.isAvailable()).toBe(false);
  });

  it('未声明 default 时回退第一个 provider', () => {
    service.load(writeYaml('e.yaml', validYaml.replace('default: deepseek\n', '')));
    const provider = service.resolveProvider();
    expect(provider.name).toBe('deepseek');
  });

  it('apiKeyEnv 缺失 → 该 provider 不可用且 listModels 不含它', () => {
    service.load(writeYaml('f.yaml', validYaml.replace('KIMI_API_KEY', 'KIMI_API_KEY_MISSING')));
    const models = service.listModels();
    expect(models.find((m) => m.name === 'kimi')).toBeUndefined();
    expect(models.find((m) => m.name === 'deepseek')?.default).toBe(true);
  });

  it('默认 provider Key 缺失 → 整体不可用（不静默回退）', () => {
    const noPool = { getKeyCount: () => 0 } as unknown as KeyPoolService;
    const mod = new ModelRegistryService(config, noPool);
    mod.load(writeYaml('g.yaml', validYaml));
    expect(mod.isAvailable()).toBe(false);
  });

  it('keyPool 池空 → 默认 provider 不可用', () => {
    const noPool = { getKeyCount: () => 0 } as unknown as KeyPoolService;
    const mod = new ModelRegistryService(config, noPool);
    mod.load(writeYaml('h.yaml', validYaml));
    expect(() => mod.resolveProvider()).toThrow();
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd server && pnpm exec vitest run src/common/model-registry/model-registry.service.spec.ts`
Expected: FAIL（`ModelRegistryService` 模块不存在）

- [ ] **Step 5: 实现 types 与 service**

`server/src/common/model-registry/model-registry.types.ts`：
```typescript
export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  apiKeyEnv?: string;
  keyPool?: boolean;
}

export interface ModelRegistryConfig {
  default?: string;
  models: Record<string, ProviderConfig>;
}

export interface ResolvedProvider {
  name: string;
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  apiKey: string;
  keySource: 'pool' | 'env';
}

export interface ModelInfo {
  name: string;
  displayName: string;
  default: boolean;
}
```

`server/src/common/model-registry/model-registry.service.ts`：
```typescript
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import { KeyPoolService } from '../key-pool/key-pool.service';
import {
  ModelInfo,
  ModelRegistryConfig,
  ProviderConfig,
  ResolvedProvider,
} from './model-registry.types';

/**
 * 模型注册表服务
 *
 * 从 server/config/models.yaml 加载多 provider 配置（displayName/baseUrl/modelId/
 * smallFastModel/Key 来源），提供 provider 解析、可用性判定与模型列表。
 * Key 来源：keyPool: true → KeyPoolService（LLM_API_KEY_N 轮换）；
 *            apiKeyEnv: NAME  → ConfigService 读取环境变量。
 */
@Injectable()
export class ModelRegistryService {
  private config: ModelRegistryConfig | null = null;
  /** provider 名 → 不可用原因（可用时不在 Map 中） */
  private readonly unavailable = new Map<string, string>();
  private readonly logger = new Logger(ModelRegistryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly keyPool: KeyPoolService,
  ) {}

  onModuleInit(): void {
    this.load();
  }

  /** 加载注册表。filePath 缺省用 server/config/models.yaml */
  load(filePath?: string): void {
    const resolvedPath =
      filePath ?? path.resolve(process.cwd(), 'config', 'models.yaml');
    try {
      const raw = readFileSync(resolvedPath, 'utf8');
      this.config = this.validate(parse(raw) as ModelRegistryConfig);
      this.evaluateAvailability();
      this.logger.log(`模型注册表加载成功，可用 provider: ${this.listModels().length} 个`);
    } catch (err) {
      this.config = null;
      this.unavailable.clear();
      this.logger.warn(`模型注册表加载失败（${(err as Error).message}），AI 功能不可用`);
    }
  }

  private validate(parsed: ModelRegistryConfig): ModelRegistryConfig {
    if (!parsed?.models || Object.keys(parsed.models).length === 0) {
      throw new Error('models 列表为空');
    }
    const names = Object.keys(parsed.models);
    for (const name of names) {
      const p = parsed.models[name];
      if (!p?.displayName || !p.baseUrl || !p.modelId || !p.smallFastModel) {
        throw new Error(`provider ${name} 缺少必填字段（displayName/baseUrl/modelId/smallFastModel）`);
      }
      if (!p.apiKeyEnv && !p.keyPool) {
        throw new Error(`provider ${name} 缺少 Key 来源（apiKeyEnv 或 keyPool）`);
      }
    }
    let defaultName = parsed.default;
    if (!defaultName) {
      defaultName = names[0];
      this.logger.warn(`models.yaml 未声明 default，回退使用第一个 provider: ${defaultName}`);
    }
    if (!names.includes(defaultName)) {
      throw new Error(`default provider ${defaultName} 不在 models 列表中`);
    }
    return { default: defaultName, models: parsed.models };
  }

  private evaluateAvailability(): void {
    if (!this.config) return;
    this.unavailable.clear();
    for (const [name, provider] of Object.entries(this.config.models)) {
      const reason = this.keyUnavailableReason(provider);
      if (reason) this.unavailable.set(name, reason);
    }
  }

  private keyUnavailableReason(provider: ProviderConfig): string | null {
    if (provider.keyPool) {
      return this.keyPool.getKeyCount() > 0 ? null : 'keyPool 池为空（LLM_API_KEY_N 未配置）';
    }
    if (provider.apiKeyEnv) {
      return this.configService.get<string>(provider.apiKeyEnv)
        ? null
        : `环境变量 ${provider.apiKeyEnv} 未配置`;
    }
    return '缺少 Key 来源';
  }

  /** 默认 provider 可用 ⇔ 注册表有效且默认 provider Key 可解析（不静默回退） */
  isAvailable(): boolean {
    if (!this.config) return false;
    return !this.unavailable.has(this.config.default!);
  }

  private getDefaultName(): string {
    return this.config?.default ?? '';
  }

  /** 解析 provider：model 指定则查表，缺省用默认；未知/不可用抛 BadRequestException */
  resolveProvider(model?: string): ResolvedProvider {
    if (!this.config) {
      throw new Error('AI 服务未配置');
    }
    const name = model ?? this.getDefaultName();
    const provider = this.config.models[name];
    if (!provider || this.unavailable.has(name)) {
      const available = this.listModels().map((m) => m.name).join(', ');
      throw new BadRequestException(`未知模型: ${name}，可用: ${available}`);
    }
    const apiKey = provider.keyPool
      ? this.keyPool.select()
      : this.configService.get<string>(provider.apiKeyEnv!)!;
    return {
      name,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      modelId: provider.modelId,
      smallFastModel: provider.smallFastModel,
      apiKey,
      keySource: provider.keyPool ? 'pool' : 'env',
    };
  }

  /** 可用 provider 列表（含 default 标记），供 GET /models */
  listModels(): ModelInfo[] {
    if (!this.config) return [];
    const def = this.getDefaultName();
    return Object.entries(this.config.models)
      .filter(([name]) => !this.unavailable.has(name))
      .map(([name, provider]) => ({ name, displayName: provider.displayName, default: name === def }));
  }
}
```

- [ ] **Step 6: 实现模块**

`server/src/common/model-registry/model-registry.module.ts`：
```typescript
import { Module } from '@nestjs/common';
import { ModelRegistryService } from './model-registry.service';

@Module({
  providers: [ModelRegistryService],
  exports: [ModelRegistryService],
})
export class ModelRegistryModule {}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd server && pnpm exec vitest run src/common/model-registry/model-registry.service.spec.ts`
Expected: PASS（9 tests）

- [ ] **Step 8: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/package.json server/pnpm-lock.yaml server/config/models.yaml server/config/models.example.yaml server/src/common/model-registry
git commit -m "feat(model-registry): 新增多模型注册表基础设施（models.yaml + 加载/校验/解析）"
```

---

### Task 2: AgentService 重构（注册表解析 + env 逐调用注入）

**Files:**
- Modify: `server/src/agent/agent.service.ts`
- Test: `server/src/agent/agent.service.spec.ts`

**Interfaces:**
- Consumes: `ModelRegistryService`（注入）、Task 1 的 `ResolvedProvider`
- Produces: `sendMessage(content: string, options?: { resume?: string; model?: string }): Promise<{ stream, interrupt }>`；`buildLangfuseHooks(model: string)`

- [ ] **Step 1: 写失败的测试（模型解析与注入）**

在 `server/src/agent/agent.service.spec.ts` 追加：
```typescript
import { ModelRegistryService } from '../common/model-registry/model-registry.service';
import { ResolvedProvider } from '../common/model-registry/model-registry.types';

const kimiProvider: ResolvedProvider = {
  name: 'kimi',
  displayName: 'Kimi K2',
  baseUrl: 'https://api.moonshot.ai/anthropic',
  modelId: 'kimi-k2.7-code',
  smallFastModel: 'kimi-k2.5',
  apiKey: 'kimi-key-1',
  keySource: 'env',
};
```

（用现有 spec 的 Test 模块骨架，Mock `ModelRegistryService`：`isAvailable: () => true`、`resolveProvider: (m) => m === 'kimi' ? kimiProvider : { ...kimiProvider, name: 'deepseek', ... }`，断言 `query()` 被调用时 options 含 `model: 'kimi-k2.7-code'` 与 `env.ANTHROPIC_BASE_URL`。）

- [ ] **Step 2: 运行确认失败**

Run: `cd server && pnpm exec vitest run src/agent/agent.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 重构 `agent.service.ts`**

```typescript
constructor(
  private readonly logger: Logger,
  private readonly configService: ConfigService,
  private readonly langfuseService: LangfuseService,
  private readonly keyPool: KeyPoolService,
  private readonly modelRegistry: ModelRegistryService,
) {
  const storeDir = path.resolve(process.cwd(), 'data', 'sessions');
  this.sessionStore = new FileSystemSessionStore(storeDir);
}

/** AI 服务是否可用（注册表可用 且 默认 provider Key 可解析） */
isAvailable(): boolean {
  return this.modelRegistry.isAvailable();
}

async sendMessage(content: string, options?: { resume?: string; model?: string }) {
  if (!this.isAvailable()) {
    throw new Error('AI 服务未配置');
  }

  // 解析所选 provider（含 Key 与 provider 级 env）
  const provider = this.modelRegistry.resolveProvider(options?.model);
  this.logger.debug(`Sending message (resume=${options?.resume ?? 'new session'}, model=${provider.name})`);

  const sessionOptions: Record<string, unknown> = {};
  if (options?.resume) {
    sessionOptions.resume = options.resume;
  }

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
            prompt: `你是 Oceanus 需求讨论助手，运行在 Oceanus AI 协作平台（网页版）。\n\n⚠️ 重要环境差异：你在网页聊天环境中运行，不是 Claude Code 终端。\n- 不要要求用户执行 /clear 命令（网页中无效）\n- 不要要求用户执行任何终端命令（如 /clear, cd 等）\n- tide-discuss 提到 "引导 /clear" 时，直接告知用户"我们开始新的需求讨论"，跳过这个步骤\n- 所有对话通过网页消息完成，用户只能打字回复\n\n你的核心能力：\n- 用户表达需求讨论意图（"我想/需要/做一个/讨论一下..."）时，\n  调用 Skill 工具加载 tide-discuss 工作流\n- 进入 tide-discuss 后，严格按照其工作流引导用户完成需求收敛\n- 项目位于 /Users/billkang/workspace/oceanus，已安装 tide-discuss skill`,
            tools: ['Skill', 'Read', 'Write', 'Bash', 'Grep', 'Glob', 'Edit', 'WebSearch', 'WebFetch'],
          },
        },
        skills: 'all',
        settingSources: ['project'],
        model: provider.modelId,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: provider.baseUrl,
          ANTHROPIC_API_KEY: provider.apiKey,
          ANTHROPIC_SMALL_FAST_MODEL: provider.smallFastModel,
        },
        effort: 'low',
        thinking: { type: 'enabled', budgetTokens: 4000 },
        maxTurns,
        maxBudgetUsd,
        ...this.buildLangfuseHooks(provider.name),
      },
    });

    return {
      stream: q,
      interrupt: () => q.interrupt(),
    };
  } catch (err) {
    // keyPool 来源的 Key 故障才标记（单 Key provider 无轮换语义）
    if (provider.keySource === 'pool') {
      this.keyPool.markFailure(provider.apiKey).catch((e) => {
        this.logger.error(`Failed to mark key failure: ${e}`);
      });
    }
    throw err;
  }
}
```

删除原 constructor 的 `ANTHROPIC_API_KEY` 读取、`process.env.ANTHROPIC_API_KEY` 突变与 finally 恢复、`selectedKey`/`originalKey` 变量。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && pnpm exec vitest run src/agent/agent.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/src/agent/agent.service.ts server/src/agent/agent.service.spec.ts
git commit -m "feat(agent): sendMessage 按注册表解析 provider，env 逐调用注入替代全局突变"
```

---

### Task 3: Chat API 透传 + GET /models

**Files:**
- Modify: `server/src/chat/dto/chat-request.dto.ts`
- Modify: `server/src/chat/chat.controller.ts`
- Modify: `server/src/chat/chat.service.ts`
- Test: `server/src/chat/chat.controller.spec.ts`、`server/src/chat/chat.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ModelRegistryService.listModels()`
- Produces: `ChatRequestDto.model?: string`；`SendStreamOptions.model?: string`；`ConfirmStreamOptions.model?: string`；`GET /models` 返回 `ModelInfo[]`

- [ ] **Step 1: DTO 新增 model 字段**

`server/src/chat/dto/chat-request.dto.ts` 新增：
```typescript
  @IsString()
  @IsOptional()
  model?: string;
```

- [ ] **Step 2: Controller 透传 + GET /models + model 校验**

`server/src/chat/chat.controller.ts`：
```typescript
import { ModelRegistryService } from '../common/model-registry/model-registry.service';
// ...
constructor(
  private readonly chatService: ChatService,
  private readonly logger: Logger,
  private readonly modelRegistry: ModelRegistryService,
) {}

@Post('chat')
async chat(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
  this.validateRequest(dto);
  // ...
  case 'message':
    await this.chatService.sendAndStream({
      content: dto.content!,
      sdkSessionId: dto.sessionId,
      projectId: dto.projectId,
      model: dto.model,
      onEvent: pushEvent,
    });
    break;
  case 'confirm':
    await this.chatService.confirmAndStream({
      sdkSessionId: dto.sessionId!,
      confirmOption: dto.confirmOption!,
      model: dto.model,
      onEvent: pushEvent,
    });
    break;
  // ...
}

@Get('models')
@ApiOperation({ summary: '获取可用模型列表' })
async getModels() {
  return this.modelRegistry.listModels();
}

private validateRequest(dto: ChatRequestDto): void {
  // ... 既有校验 ...
  if (dto.model) {
    const available = this.modelRegistry.listModels();
    if (!available.some((m) => m.name === dto.model)) {
      throw new BadRequestException(
        `未知模型: ${dto.model}，可用: ${available.map((m) => m.name).join(', ')}`,
      );
    }
  }
}
```

- [ ] **Step 3: ChatService 透传 model**

`server/src/chat/chat.service.ts`：
```typescript
export interface SendStreamOptions {
  content: string;
  sdkSessionId?: string;
  projectId?: string | number;
  model?: string;
  onEvent: SseEventCallback;
}

export interface ConfirmStreamOptions {
  sdkSessionId: string;
  confirmOption: string;
  model?: string;
  onEvent: SseEventCallback;
}
```
`sendAndStream` 解构加 `model`，调用处：
```typescript
const result = isFirstMessage
  ? await this.agentService.sendMessage(content, model ? { model } : undefined)
  : await this.agentService.sendMessage(content, { resume: normalizedSessionId!, ...(model ? { model } : {}) });
```
`confirmAndStream` 调用 `sendAndStream` 透传 `model`：
```typescript
await this.sendAndStream({
  content: confirmOption,
  sdkSessionId,
  model,
  onEvent,
});
```

- [ ] **Step 4: 更新测试**

`chat.controller.spec.ts` / `chat.service.spec.ts` 补充：`message` 请求带 `model` 透传至 `sendAndStream`；`confirm` 带 `model`；未知 `model` 时 `validateRequest` 抛 `BadRequestException`；`GET /models` 返回 `listModels()` 结果。

- [ ] **Step 5: 运行测试**

Run: `cd server && pnpm exec vitest run src/chat/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/src/chat
git commit -m "feat(chat): 透传 model 参数（message/confirm）+ 新增 GET /models 端点"
```

---

### Task 4: KeyPool 移除 ANTHROPIC_API_KEY 兜底

**Files:**
- Modify: `server/src/common/key-pool/key-pool.service.ts`
- Test: `server/src/common/key-pool/key-pool.service.spec.ts`

**Interfaces:**
- Consumes: 无新依赖
- Produces: `loadKeysFromEnv()` 仅加载 `LLM_API_KEY_N`

- [ ] **Step 1: 写失败测试**

`key-pool.service.spec.ts` 新增：
```typescript
it('不再加载 ANTHROPIC_API_KEY 兜底', () => {
  const cfg = new ConfigService({ ANTHROPIC_API_KEY: 'fallback-key' });
  const service = new KeyPoolService(new Logger(), cfg);
  service.onModuleInit();
  expect(service.getKeyCount()).toBe(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && pnpm exec vitest run src/common/key-pool/key-pool.service.spec.ts`
Expected: FAIL（当前会加载兜底，count=1）

- [ ] **Step 3: 实现 — 删除兜底**

`server/src/common/key-pool/key-pool.service.ts` `loadKeysFromEnv` 删除 `// Fallback to ANTHROPIC_API_KEY` 整段；`select()` 的报错文案更新为 `'AI 服务不可用，请配置 LLM_API_KEY_N'`。

- [ ] **Step 4: 运行测试通过 + 更新依赖此行为的老用例**

Run: `cd server && pnpm exec vitest run src/common/key-pool/key-pool.service.spec.ts`
Expected: PASS；同步检查 `agent.service.spec.ts` 若有用 `ANTHROPIC_API_KEY` 建 service 的用例，改注入 registry mock。

- [ ] **Step 5: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/src/common/key-pool
git commit -m "refactor(key-pool): 移除 ANTHROPIC_API_KEY 兜底，Key 来源统一走模型注册表"
```

---

### Task 5: Langfuse 模型名可观测性

**Files:**
- Modify: `server/src/common/langfuse/langfuse.service.ts`
- Modify: `server/src/agent/agent.service.ts`
- Test: `server/src/common/langfuse/langfuse.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 `buildLangfuseHooks(model: string)`
- Produces: `createTrace(sdkSessionId: string, projectId?: string, model?: string)`

- [ ] **Step 1: 写失败测试**

`langfuse.service.spec.ts` 断言：`createTrace('sid', undefined, 'kimi')` 创建的 trace tags 含 `model:kimi`。

- [ ] **Step 2: 运行确认失败**

Run: `cd server && pnpm exec vitest run src/common/langfuse/langfuse.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`langfuse.service.ts`：
```typescript
createTrace(sdkSessionId: string, projectId?: string, model?: string): string | null {
  // ...
  const tags = ['oceanus'];
  if (projectId) tags.push(`project:${projectId}`);
  if (model) tags.push(`model:${model}`);
  // ...
}
```
`agent.service.ts` `buildLangfuseHooks` 签名改为 `(model: string)`，`SessionStart` hook 内调用 `lf.createTrace(input.session_id, undefined, model)`。

- [ ] **Step 4: 运行测试**

Run: `cd server && pnpm exec vitest run src/common/langfuse src/agent`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/src/common/langfuse server/src/agent/agent.service.ts
git commit -m "feat(observability): Langfuse trace 记录模型名"
```

---

### Task 6: 前端模型选择器

**Files:**
- Modify: `client/src/app/chat/chat.service.ts`
- Modify: `client/src/app/chat/chat.component.ts`
- Modify: `client/src/app/chat/chat.component.html`
- Test: `client/src/app/chat/chat.service.spec.ts`、`client/src/app/chat/chat.component.spec.ts`

**Interfaces:**
- Consumes: `GET /api/v1/models` → `{ name, displayName, default }[]`
- Produces: `ChatService.getModels(): Observable<ModelInfo[]>`；`sendMessage`/confirm 请求体含 `model`

- [ ] **Step 1: chat.service 新增 getModels + model 透传**

`client/src/app/chat/chat.service.ts`：
```typescript
export interface ModelInfo {
  name: string;
  displayName: string;
  default: boolean;
}

getModels(): Observable<ModelInfo[]> {
  return this.http.get<ModelInfo[]>('/api/v1/models', { headers: this.getAuthHeaders() });
}
```
`sendMessage` 的 body 与 confirm 请求体加 `if (options.model) body['model'] = options.model;`。

- [ ] **Step 2: chat.component 选择器逻辑**

`chat.component.ts`：
```typescript
models = signal<ModelInfo[]>([]);
selectedModel = signal<string | null>(null);

ngOnInit(): void {
  this.chatService.getModels().subscribe((models) => {
    this.models.set(models);
    this.selectedModel.set(models.find((m) => m.default)?.name ?? models[0]?.name ?? null);
  });
}

onSend(): void {
  // 原发送逻辑，body 增加 model: this.selectedModel() ?? undefined
}
```
HTML：输入区上方 `@if (models().length > 1)` 渲染 `p-dropdown`，`[options]="models()"`（`optionLabel="displayName"`，`optionValue="name"`），`[(ngModel)]="selectedModel"`。

- [ ] **Step 3: 更新测试**

`chat.component.spec.ts`：mock `getModels` 返回 2 个模型 → dropdown 渲染；返回 1 个 → 不渲染且 `sendMessage` 不带 `model`。`chat.service.spec.ts`：断言请求体含 `model`。

- [ ] **Step 4: 运行测试**

Run: `cd client && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add client/src/app/chat
git commit -m "feat(chat-ui): 模型选择器（多模型时渲染）+ 请求携带 model"
```

---

### Task 7: 配置与环境迁移

**Files:**
- Modify: `server/.env.example`
- Modify: `server/.env`
- Create: `server/config/models.example.yaml`（Task 1 已建，此处确认提交）

- [ ] **Step 1: `.env.example` 迁移说明**

`server/.env.example` 的 `# ── Claude Agent SDK ──` 段，将 `ANTHROPIC_BASE_URL` / `ANTHROPIC_SMALL_FAST_MODEL` 行替换为注释说明：
```bash
# ── 模型注册表（自 vX 起取代全局 ANTHROPIC_*）──
# provider 结构配置见 server/config/models.yaml（模板 models.example.yaml）
# Key 仍走环境变量（provider 的 apiKeyEnv 指向这里）：
#   LLM_API_KEY_N        deepseek 多 Key 轮换（keyPool: true）
#   KIMI_API_KEY         kimi 单 Key
```

- [ ] **Step 2: 本地 `.env` 补 `KIMI_API_KEY`**

`server/.env` 追加（占位，真实 Key 由使用者填）：`KIMI_API_KEY=`。

- [ ] **Step 3: Commit**

```bash
cd /Users/billkang/workspace/oceanus
git add server/.env.example server/.env
git commit -m "chore(env): 模型注册表迁移说明 + KIMI_API_KEY"
```

---

### Task 8: 文档同步

**Files:**
- Modify: `docs/1-getting-started/`（env 迁移）
- Modify: `docs/3-api/api-reference.md`（`POST /chat` 新字段 + `GET /models`）
- Create: `docs/2-architecture/decisions/ADR-013-multi-model-runtime-switching.md`
- Modify: `.deepstorm/context.md`（AI 模型条目）

- [ ] **Step 1: getting-started env 迁移说明**

在 `docs/1-getting-started/` 相关章节补充：`ANTHROPIC_*` 废弃 → 改 `server/config/models.yaml` + per-provider Key。

- [ ] **Step 2: API 文档**

`docs/3-api/api-reference.md`：`POST /chat` 请求体新增 `model?`（string）；新增 `GET /models` 端点（响应示例 + 401）。

- [ ] **Step 3: ADR-013**

`docs/2-architecture/decisions/ADR-013-multi-model-runtime-switching.md`：记录 D1–D9 决策（配置载体 / Key 隔离 / env 注入 / 注册表服务 / GET /models / 透传链 / 可用性语义 / Langfuse / 前端选择器）与关键权衡（breaking 迁移、默认 provider 单点、Kimi 端点风险）。

- [ ] **Step 4: context.md 同步**

`.deepstorm/context.md`：`AI 模型` 条目更新为"多模型注册（change multi-model-runtime-switching 实现中）：models.yaml 定义 provider，前端选择，query() 逐调用 model+env"。

- [ ] **Step 5: 全量验证 + Commit**

```bash
cd /Users/billkang/workspace/oceanus
cd server && pnpm typecheck && pnpm test
cd ../client && pnpm typecheck && pnpm test
cd .. && git add docs .deepstorm
git commit -m "docs: 多模型注册文档同步（env 迁移/API/ADR-013/context）"
```

---

## Self-Review

**1. Spec coverage:**
- model-registry「模型注册表加载」→ Task 1.2/1.3/1.4 ✅
- model-registry「Key 来源解析」「默认 provider Key 缺失」→ Task 1.4/1.6 ✅
- model-registry「模型解析与参数校验」→ Task 1.5 + Task 3.2（controller 400）✅
- model-registry「query 逐调用注入」→ Task 2.3 ✅
- model-registry「GET /models 端点」「未认证 401」→ Task 3.4（JWT guard 复用）✅
- model-registry「模型选择器条件渲染」→ Task 6.2/6.3 ✅
- agent-integration「SDK 初始化 / oceanus-tide 配置 / AiNotConfigured」→ Task 2 ✅
- agent-integration「模型参数透传」「confirm 续传携带模型」→ Task 3.2/3.3 ✅
- agent-integration「模型名可观测性」→ Task 5 ✅
- api-key-pool「移除 ANTHROPIC_API_KEY 兜底」→ Task 4 ✅

**2. Placeholder scan:** 无 TBD/TODO；所有测试与实现代码已内联。✅

**3. Type consistency:**
- `ResolvedProvider`（Task 1）→ `agent.service`（Task 2）字段名一致 ✅
- `sendMessage(content, { resume?, model? })`（Task 2）→ `chat.service`（Task 3）调用签名一致 ✅
- `createTrace(sdkSessionId, projectId?, model?)`（Task 5）→ `buildLangfuseHooks(model)` 调用一致 ✅
- `ModelInfo { name, displayName, default }`（Task 1）→ `GET /models`（Task 3）→ 前端 `getModels`（Task 6）一致 ✅
