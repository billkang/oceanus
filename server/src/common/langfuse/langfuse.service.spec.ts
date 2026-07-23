import type { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { LangfuseService } from './langfuse.service';

describe('LangfuseService', () => {
  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

  /** 创建一个配置了指定值的 LangfuseService */
  function createService(configValues: Record<string, string | undefined>) {
    const mockConfig = {
      get: (key: string) => configValues[key],
    } as unknown as ConfigService;

    return new LangfuseService(mockConfig, mockLogger);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('graceful degradation', () => {
    it('LANGFUSE_BASE_URL 未配置时应跳过初始化', () => {
      const service = createService({});
      service.onModuleInit();

      expect(service.isAvailable).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith('Langfuse: LANGFUSE_BASE_URL 未配置，跳过初始化');
    });

    it('LANGFUSE_KEY 缺失时应跳过初始化', () => {
      const service = createService({ LANGFUSE_BASE_URL: 'http://localhost:3000' });
      service.onModuleInit();

      expect(service.isAvailable).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('LANGFUSE_PUBLIC_KEY'),
      );
    });

    it('不可用时所有方法不应抛异常', async () => {
      const service = createService({});

      expect(() => {
        service.createTrace('session-uuid');
        service.createToolSpan('session-uuid', 'read');
        service.markToolError('session-uuid', 'read', 'error');
        service.recordGeneration('session-uuid', 'input', 'output');
        service.recordThinking('session-uuid', 'thinking content');
      }).not.toThrow();

      await expect(service.flushTrace('session-uuid')).resolves.toBeUndefined();
      await expect(service.finalizeTrace('session-uuid')).resolves.toBeUndefined();
    });

    it('不可用时 isAvailable 应为 false', () => {
      const service = createService({});
      expect(service.isAvailable).toBe(false);
    });
  });

  describe('recordGeneration / recordThinking / flushTrace', () => {
    it('不可用时 recordGeneration 不操作', () => {
      const service = createService({});
      expect(() => service.recordGeneration('s1', 'input', 'output')).not.toThrow();
    });

    it('不可用时 recordThinking 不操作', () => {
      const service = createService({});
      expect(() => service.recordThinking('s1', 'thinking')).not.toThrow();
    });

    it('不可用时 flushTrace 不操作', async () => {
      const service = createService({});
      await expect(service.flushTrace('s1')).resolves.toBeUndefined();
    });

    it('不可用时 finalizeTrace 不操作', async () => {
      const service = createService({});
      await expect(service.finalizeTrace('session-uuid')).resolves.toBeUndefined();
    });
  });
});
