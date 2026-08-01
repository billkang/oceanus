import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { KeyPoolService } from '../key-pool/key-pool.service';
import { ModelRegistryService } from './model-registry.service';

describe('ModelRegistryService', () => {
  let service: ModelRegistryService;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-reg-'));
  const writeYaml = (name: string, content: string) => {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const keyPool = { getKeyCount: () => 2, select: async () => 'pool-key-1' } as unknown as KeyPoolService;
  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
  const env: Record<string, string> = { KIMI_API_KEY: 'kimi-key-1' };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: ConfigService, useValue: config },
        { provide: KeyPoolService, useValue: keyPool },
        { provide: Logger, useValue: mockLogger },
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

  it('正常加载并解析默认 provider', async () => {
    service.load(writeYaml('a.yaml', validYaml));
    const provider = await service.resolveProvider();
    expect(provider.name).toBe('deepseek');
    expect(provider.modelId).toBe('claude-sonnet-5');
    expect(provider.keySource).toBe('pool');
    expect(provider.apiKey).toBe('pool-key-1');
  });

  it('指定 kimi 时返回 kimi 配置（env Key）', async () => {
    service.load(writeYaml('b.yaml', validYaml));
    const provider = await service.resolveProvider('kimi');
    expect(provider.name).toBe('kimi');
    expect(provider.baseUrl).toContain('moonshot');
    expect(provider.apiKey).toBe('kimi-key-1');
    expect(provider.keySource).toBe('env');
  });

  it('未知模型抛 BadRequestException 且信息含可用列表', async () => {
    service.load(writeYaml('c.yaml', validYaml));
    try {
      await service.resolveProvider('unknown');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).message).toContain('deepseek');
      expect((e as BadRequestException).message).toContain('kimi');
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

  it('未声明 default 时回退第一个 provider', async () => {
    service.load(writeYaml('e.yaml', validYaml.replace('default: deepseek\n', '')));
    const provider = await service.resolveProvider();
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
    const mod = new ModelRegistryService(config, noPool, mockLogger);
    mod.load(writeYaml('g.yaml', validYaml));
    expect(mod.isAvailable()).toBe(false);
  });

  it('keyPool 池空 → 默认 provider 不可用', async () => {
    const noPool = { getKeyCount: () => 0 } as unknown as KeyPoolService;
    const mod = new ModelRegistryService(config, noPool, mockLogger);
    mod.load(writeYaml('h.yaml', validYaml));
    await expect(mod.resolveProvider()).rejects.toThrow();
  });

  describe('命名池 / 单 Key 双支持', () => {
    // deepseek 全局池 + kimi 命名池（keyPool 对象）且同时声明 apiKeyEnv 单 Key 兜底
    const bothYaml = `
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
    keyPool:
      envPrefix: 'KIMI_API_KEY_'
    apiKeyEnv: KIMI_API_KEY
`;
    const namedPool = {
      getKeyCount: (prefix?: string) => (prefix === 'KIMI_API_KEY_' ? 2 : 2),
      select: vi.fn(async (prefix?: string) => (prefix === 'KIMI_API_KEY_' ? 'kimi-pool-key' : 'pool-key-1')),
    } as unknown as KeyPoolService;

    it('命名池（keyPool: { envPrefix }）应从该池 select', async () => {
      const mod = new ModelRegistryService(config, namedPool, mockLogger);
      mod.load(writeYaml('both-1.yaml', bothYaml));
      const provider = await mod.resolveProvider('kimi');
      expect(namedPool.select).toHaveBeenCalledWith('KIMI_API_KEY_');
      expect(provider.apiKey).toBe('kimi-pool-key');
      expect(provider.keySource).toBe('pool');
    });

    it('命名池空且声明 apiKeyEnv → 回退单 Key（keySource=env）', async () => {
      const emptyNamedPool = {
        getKeyCount: (prefix?: string) => (prefix === 'KIMI_API_KEY_' ? 0 : 2),
        select: async () => 'pool-key-1',
      } as unknown as KeyPoolService;
      const mod = new ModelRegistryService(config, emptyNamedPool, mockLogger);
      mod.load(writeYaml('both-2.yaml', bothYaml));
      const provider = await mod.resolveProvider('kimi');
      expect(provider.apiKey).toBe('kimi-key-1');
      expect(provider.keySource).toBe('env');
    });

    it('命名池空且无 apiKeyEnv → kimi 不可用且 listModels 不含它', async () => {
      const emptyNamedPool = {
        getKeyCount: (prefix?: string) => (prefix === 'KIMI_API_KEY_' ? 0 : 2),
        select: async () => 'pool-key-1',
      } as unknown as KeyPoolService;
      const mod = new ModelRegistryService(config, emptyNamedPool, mockLogger);
      mod.load(writeYaml('both-3.yaml', bothYaml.replace('    apiKeyEnv: KIMI_API_KEY\n', '')));
      const models = mod.listModels();
      expect(models.find((m) => m.name === 'kimi')).toBeUndefined();
      expect(models.find((m) => m.name === 'deepseek')).toBeDefined();
    });

    it('全局池（keyPool: true）仍走全局 select（不传前缀）', async () => {
      const mod = new ModelRegistryService(config, namedPool, mockLogger);
      mod.load(writeYaml('both-4.yaml', bothYaml));
      const provider = await mod.resolveProvider();
      expect(provider.apiKey).toBe('pool-key-1');
      expect(provider.keySource).toBe('pool');
    });
  });
});
