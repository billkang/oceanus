vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  deleteSession: vi.fn(),
}));

import { BadRequestException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AgentService } from './agent.service';
import type { ConfigService } from '@nestjs/config';
import * as sdk from '@anthropic-ai/claude-agent-sdk';
import { LangfuseService } from '../common/langfuse/langfuse.service';
import { ModelRegistryService } from '../common/model-registry/model-registry.service';
import { ResolvedProvider } from '../common/model-registry/model-registry.types';

// LangfuseService 空实现（默认注入，isAvailable=false 不执行实际操作）
const nullLangfuse = {
  isAvailable: false,
  createTrace: vi.fn(),
  createToolSpan: vi.fn(),
  markToolError: vi.fn(),
  setUsage: vi.fn(),
  finalizeTrace: vi.fn().mockResolvedValue(undefined),
} as unknown as LangfuseService;

// LangfuseService mock factory（用于钩子验证测试）
const createMockLangfuse = () =>
  ({
    isAvailable: true,
    createTrace: vi.fn().mockReturnValue('trace-id'),
    createToolSpan: vi.fn(),
    markToolError: vi.fn(),
    setUsage: vi.fn(),
    finalizeTrace: vi.fn().mockResolvedValue(undefined),
  }) as unknown as LangfuseService;

// KeyPool mock
const mockKeyPool = {
  select: vi.fn().mockResolvedValue('pool-key-1'),
  markFailure: vi.fn().mockResolvedValue(undefined),
  getPoolStats: vi.fn(),
  getKeyCount: vi.fn().mockReturnValue(1),
};

// 模型注册表 mock — 默认 deepseek（keyPool），kimi（env Key）
const deepseekProvider: ResolvedProvider = {
  name: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/anthropic',
  modelId: 'deepseek-v4-flash',
  smallFastModel: 'deepseek-v4-flash',
  apiKey: 'pool-key-1',
  keySource: 'pool',
};

const kimiProvider: ResolvedProvider = {
  name: 'kimi',
  displayName: 'Kimi K2',
  baseUrl: 'https://api.moonshot.ai/anthropic',
  modelId: 'kimi-k2.7-code',
  smallFastModel: 'kimi-k2.5',
  apiKey: 'kimi-key-1',
  keySource: 'env',
};

const createMockRegistry = (overrides: Record<string, unknown> = {}) =>
  ({
    isAvailable: vi.fn().mockReturnValue(true),
    resolveProvider: vi
      .fn()
      .mockImplementation(async (model?: string) => (model === 'kimi' ? kimiProvider : deepseekProvider)),
    listModels: vi.fn().mockReturnValue([
      { name: 'deepseek', displayName: 'DeepSeek', default: true },
      { name: 'kimi', displayName: 'Kimi K2', default: false },
    ]),
    ...overrides,
  }) as unknown as ModelRegistryService;

describe('AgentService', () => {
  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

  // 仅用于 env 读取（available 语义已委托注册表）
  const mockConfig = () => ({ get: (_key: string) => undefined }) as ConfigService;

  // 可返回任意 env 键的配置工厂
  const mockEnvConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as ConfigService;

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('注册表可用时返回 true', () => {
      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      expect(service.isAvailable()).toBe(true);
    });

    it('注册表不可用时返回 false', () => {
      const registry = createMockRegistry({ isAvailable: vi.fn().mockReturnValue(false) });
      const service = new AgentService(mockLogger, mockConfig(), nullLangfuse, mockKeyPool as any, registry);
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('getAgentLimits', () => {
    it('未配置时应回退默认 15 / 1.00', () => {
      const service = new AgentService(
        mockLogger,
        mockEnvConfig({}),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      expect(service.getAgentLimits()).toEqual({ maxTurns: 15, maxBudgetUsd: 1.0 });
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('AGENT_MAX_TURNS'));
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('AGENT_MAX_BUDGET_USD'));
    });

    it('空值 / 非数字 / 0 / 负数应回退默认', () => {
      const config = mockEnvConfig({ AGENT_MAX_TURNS: 'abc', AGENT_MAX_BUDGET_USD: '0' });
      const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any, createMockRegistry());
      expect(service.getAgentLimits()).toEqual({ maxTurns: 15, maxBudgetUsd: 1.0 });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('AGENT_MAX_TURNS'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('AGENT_MAX_BUDGET_USD'));
    });

    it('合法值应生效', () => {
      const config = mockEnvConfig({ AGENT_MAX_TURNS: '20', AGENT_MAX_BUDGET_USD: '2.5' });
      const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any, createMockRegistry());
      expect(service.getAgentLimits()).toEqual({ maxTurns: 20, maxBudgetUsd: 2.5 });
    });

    it('maxTurns 非整数（15.5）应视为非法回退默认', () => {
      const config = mockEnvConfig({ AGENT_MAX_TURNS: '15.5', AGENT_MAX_BUDGET_USD: '2.5' });
      const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any, createMockRegistry());
      expect(service.getAgentLimits()).toEqual({ maxTurns: 15, maxBudgetUsd: 2.5 });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('AGENT_MAX_TURNS'));
    });

    it('query options 应包含解析后的 maxTurns 与 maxBudgetUsd', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const config = mockEnvConfig({
        AGENT_MAX_TURNS: '20',
        AGENT_MAX_BUDGET_USD: '2.5',
      });
      const service = new AgentService(mockLogger, config, nullLangfuse, mockKeyPool as any, createMockRegistry());
      await service.sendMessage('hello');

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.maxTurns).toBe(20);
      expect(queryOptions?.maxBudgetUsd).toBe(2.5);
    });
  });

  describe('sendMessage', () => {
    it('应创建 SDK query 并返回事件流', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: '分析中' } },
        };
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '需求' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      const { stream } = await service.sendMessage('帮我分析需求');
      const events: unknown[] = [];
      for await (const msg of stream) {
        events.push(msg);
      }

      expect(events).toHaveLength(2);
      expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({ prompt: '帮我分析需求' }));
    });

    it('首条消息不传 sessionId，让 SDK 自动生成新会话', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await service.sendMessage('hello');

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.continue).toBeUndefined();
      expect(queryOptions?.sessionId).toBeUndefined();
      expect(queryOptions?.resume).toBeUndefined();
      expect(queryOptions?.forkSession).toBeUndefined();
    });

    it('续传消息应使用 resume: sessionId', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: '继续' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await service.sendMessage('继续', { resume: 'sdk-uuid-abc' });

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.resume).toBe('sdk-uuid-abc');
      expect(queryOptions?.continue).toBeUndefined();
    });

    it('默认 provider 时 query options 应含默认 modelId 与 provider 级 env（替代全局 env 突变）', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await service.sendMessage('hello');

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.model).toBe('deepseek-v4-flash');
      expect(queryOptions?.env).toMatchObject({
        ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
        ANTHROPIC_API_KEY: 'pool-key-1',
        ANTHROPIC_SMALL_FAST_MODEL: 'deepseek-v4-flash',
      });
      // 不再突变全局环境变量（无副作用残留）
      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('指定 model=kimi 时使用 kimi 的 modelId 与 env', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await service.sendMessage('hello', { model: 'kimi' });

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.model).toBe('kimi-k2.7-code');
      expect(queryOptions?.env).toMatchObject({
        ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
        ANTHROPIC_API_KEY: 'kimi-key-1',
        ANTHROPIC_SMALL_FAST_MODEL: 'kimi-k2.5',
      });
    });

    it('注册表不可用时抛出 AI 服务未配置', async () => {
      const registry = createMockRegistry({ isAvailable: vi.fn().mockReturnValue(false) });
      const service = new AgentService(mockLogger, mockConfig(), nullLangfuse, mockKeyPool as any, registry);

      await expect(service.sendMessage('hello')).rejects.toThrow('AI 服务未配置');
    });

    it('resolveProvider 未知模型抛 BadRequestException 时向上传播', async () => {
      const registry = createMockRegistry({
        resolveProvider: vi.fn().mockRejectedValue(new BadRequestException('未知模型: x，可用: deepseek, kimi')),
      });
      const service = new AgentService(mockLogger, mockConfig(), nullLangfuse, mockKeyPool as any, registry);

      await expect(service.sendMessage('hello', { model: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keyPool 来源 provider 调用失败时标记 Key 故障', async () => {
      vi.mocked(sdk.query).mockImplementation(() => {
        throw new Error('boom');
      });

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await expect(service.sendMessage('hello')).rejects.toThrow('boom');
      expect(mockKeyPool.markFailure).toHaveBeenCalledWith('pool-key-1');
    });

    it('env 来源 provider 调用失败时不标记 Key 故障', async () => {
      vi.mocked(sdk.query).mockImplementation(() => {
        throw new Error('boom');
      });

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await expect(service.sendMessage('hello', { model: 'kimi' })).rejects.toThrow('boom');
      expect(mockKeyPool.markFailure).not.toHaveBeenCalled();
    });

    it('LangfuseService 注入时 hooks 应包含 SessionStart/PostToolUse/SessionEnd', async () => {
      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      const langfuse = createMockLangfuse();
      const service = new AgentService(mockLogger, mockConfig(), langfuse, mockKeyPool as any, createMockRegistry());
      await service.sendMessage('hello');

      const optionsArg = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect((optionsArg as { hooks?: Record<string, unknown> }).hooks?.['SessionStart']).toBeDefined();
      expect((optionsArg as { hooks?: Record<string, unknown> }).hooks?.['PostToolUse']).toBeDefined();
      expect((optionsArg as { hooks?: Record<string, unknown> }).hooks?.['PostToolUseFailure']).toBeDefined();
      expect((optionsArg as { hooks?: Record<string, unknown> }).hooks?.['SessionEnd']).toBeDefined();
    });
  });

  describe('getSessionMessages', () => {
    it('应调用 SDK getSessionMessages', async () => {
      vi.mocked(sdk.getSessionMessages).mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] } as never,
      ]);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      const result = await service.getSessionMessages('session-uuid');

      expect(result).toHaveLength(1);
      expect(sdk.getSessionMessages).toHaveBeenCalledWith('session-uuid', expect.any(Object));
    });
  });

  describe('destroyAgent', () => {
    it('应删除 SDK 会话', async () => {
      vi.mocked(sdk.deleteSession).mockResolvedValue(undefined);

      const service = new AgentService(
        mockLogger,
        mockConfig(),
        nullLangfuse,
        mockKeyPool as any,
        createMockRegistry(),
      );
      await service.destroyAgent('session-uuid');

      expect(sdk.deleteSession).toHaveBeenCalledWith('session-uuid', expect.any(Object));
    });
  });
});
