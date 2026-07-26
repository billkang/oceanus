vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  deleteSession: vi.fn(),
}));

import { Logger } from 'nestjs-pino';
import { AgentService } from './agent.service';
import type { ConfigService } from '@nestjs/config';
import * as sdk from '@anthropic-ai/claude-agent-sdk';
import { LangfuseService } from '../common/langfuse/langfuse.service';

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

describe('AgentService', () => {
  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

  const mockConfig = (apiKey?: string) =>
    ({ get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? apiKey : undefined) }) as ConfigService;

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('ANTHROPIC_API_KEY 配置时应返回 true', () => {
      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      expect(service.isAvailable()).toBe(true);
    });

    it('ANTHROPIC_API_KEY 未配置但 KeyPool 有 Key 时应返回 true', () => {
      const service = new AgentService(mockLogger, mockConfig(undefined), nullLangfuse, mockKeyPool as any);
      expect(service.isAvailable()).toBe(true);
    });

    it('ANTHROPIC_API_KEY 和 KeyPool 均空时应返回 false', () => {
      mockKeyPool.getKeyCount.mockReturnValue(0);
      const service = new AgentService(mockLogger, mockConfig(undefined), nullLangfuse, mockKeyPool as any);
      expect(service.isAvailable()).toBe(false);
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

      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      const { stream } = await service.sendMessage('帮我分析需求');
      const events: any[] = [];
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

      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
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

      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      await service.sendMessage('继续', { resume: 'sdk-uuid-abc' });

      const queryOptions = vi.mocked(sdk.query).mock.calls[0][0].options;
      expect(queryOptions?.resume).toBe('sdk-uuid-abc');
      expect(queryOptions?.continue).toBeUndefined();
    });

    it('应使用 KeyPool 选择 API Key 并在完成后恢复环境变量', async () => {
      const originalKey = 'test-original-key';
      process.env.ANTHROPIC_API_KEY = originalKey;

      const mockGenerate = (async function* () {
        yield {
          type: 'stream_event' as const,
          event: { type: 'content_block_start', content_block: { type: 'text', text: 'OK' } },
        };
      })();
      vi.mocked(sdk.query).mockReturnValue(mockGenerate as any);

      mockKeyPool.select.mockResolvedValue('pool-selected-key');
      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      await service.sendMessage('hello');

      // KeyPool.select 被调用
      expect(mockKeyPool.select).toHaveBeenCalled();
      // SDK query 被调用（env var 在调用期间已设置）
      expect(sdk.query).toHaveBeenCalled();
      // 完成后恢复原始环境变量
      expect(process.env.ANTHROPIC_API_KEY).toBe(originalKey);

      process.env.ANTHROPIC_API_KEY = undefined;
    });

    it('未配置 API Key 时应抛出错误', async () => {
      const service = new AgentService(mockLogger, mockConfig(undefined), nullLangfuse, mockKeyPool as any);

      await expect(service.sendMessage('hello')).rejects.toThrow('AI 服务未配置');
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
      const service = new AgentService(mockLogger, mockConfig('test-key'), langfuse, mockKeyPool as any);
      await service.sendMessage('hello');

      const optionsArg = vi.mocked(sdk.query).mock.calls[0][0].options;
      // LangfuseService 启用时 hooks 应嵌套在 options.hooks 下
      expect((optionsArg as any).hooks?.['SessionStart']).toBeDefined();
      expect((optionsArg as any).hooks?.['PostToolUse']).toBeDefined();
      expect((optionsArg as any).hooks?.['PostToolUseFailure']).toBeDefined();
      expect((optionsArg as any).hooks?.['SessionEnd']).toBeDefined();
    });
  });

  describe('getSessionMessages', () => {
    it('应调用 SDK getSessionMessages', async () => {
      vi.mocked(sdk.getSessionMessages).mockResolvedValue([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] } as any,
      ]);

      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      const result = await service.getSessionMessages('session-uuid');

      expect(result).toHaveLength(1);
      expect(sdk.getSessionMessages).toHaveBeenCalledWith('session-uuid', expect.any(Object));
    });
  });

  describe('destroyAgent', () => {
    it('应删除 SDK 会话', async () => {
      vi.mocked(sdk.deleteSession).mockResolvedValue(undefined);

      const service = new AgentService(mockLogger, mockConfig('test-key'), nullLangfuse, mockKeyPool as any);
      await service.destroyAgent('session-uuid');

      expect(sdk.deleteSession).toHaveBeenCalledWith('session-uuid', expect.any(Object));
    });
  });
});
