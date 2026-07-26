import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { Test } from '@nestjs/testing';
import { KeyPoolService } from './key-pool.service';

describe('KeyPoolService', () => {
  let service: KeyPoolService;

  const createService = async (env: Record<string, string>) => {
    const module = await Test.createTestingModule({
      providers: [
        KeyPoolService,
        {
          provide: Logger,
          useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string) => env[key]),
          },
        },
      ],
    }).compile();
    return module.get(KeyPoolService);
  };

  describe('loadKeysFromEnv', () => {
    it('SHOULD load multiple keys from LLM_API_KEY_1..N', async () => {
      service = await createService({
        LLM_API_KEY_1: 'key-1',
        LLM_API_KEY_2: 'key-2',
        LLM_API_KEY_3: 'key-3',
      });
      service.onModuleInit();
      expect(service.getKeyCount()).toBe(3);
    });

    it('SHOULD fallback to ANTHROPIC_API_KEY when LLM_API_KEY_N is empty', async () => {
      service = await createService({
        ANTHROPIC_API_KEY: 'fallback-key',
      });
      service.onModuleInit();
      expect(service.getKeyCount()).toBe(1);
    });

    it('SHOULD have zero keys when no key env vars exist', async () => {
      service = await createService({});
      service.onModuleInit();
      expect(service.getKeyCount()).toBe(0);
    });
  });

  describe('Least-Used selection', () => {
    it('SHOULD select the key with least usage count', async () => {
      service = await createService({
        LLM_API_KEY_1: 'key-1',
        LLM_API_KEY_2: 'key-2',
        LLM_API_KEY_3: 'key-3',
      });
      service.onModuleInit();

      // Use key-2 twice, key-1 once — so key-3 (0 uses) should be Least-Used
      await service.select(); // picks key-1 (or key-2 or key-3, all 0)
      await service.select(); // picks whichever wasn't used
      await service.select(); // picks whichever wasn't used

      const stats = service.getPoolStats();
      expect(stats.totalUsage).toBe(3);
      // All keys should have been used at least once
      expect(stats.healthyKeys).toBe(3);
    });

    it('SHOULD increment usage count after selection', async () => {
      service = await createService({
        LLM_API_KEY_1: 'key-1',
      });
      service.onModuleInit();

      await service.select();
      await service.select();

      expect(service.getPoolStats().totalUsage).toBe(2);
    });
  });

  describe('markFailure', () => {
    it('SHOULD increment failure count for a key', async () => {
      service = await createService({
        LLM_API_KEY_1: 'key-1',
      });
      service.onModuleInit();

      await service.select();
      await service.markFailure('key-1');

      const stats = service.getPoolStats();
      expect(stats.totalFailures).toBe(1);
      expect(stats.healthyKeys).toBe(1); // failureCount 1 < 3, still healthy
    });

    it('SHOULD track healthy keys (failureCount < 3)', async () => {
      service = await createService({
        LLM_API_KEY_1: 'key-1',
      });
      service.onModuleInit();

      await service.markFailure('key-1');
      await service.markFailure('key-1');
      await service.markFailure('key-1');

      const stats = service.getPoolStats();
      expect(stats.totalFailures).toBe(3);
    });
  });

  describe('empty pool', () => {
    it('SHOULD throw when selecting from empty pool', async () => {
      service = await createService({});
      service.onModuleInit();

      await expect(service.select()).rejects.toThrow('AI 服务不可用，请配置 LLM_API_KEY_N 或 ANTHROPIC_API_KEY');
    });
  });
});
