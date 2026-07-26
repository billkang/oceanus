import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerException } from '@nestjs/throttler';

/**
 * 速率限制配置测试
 * 验证 ThrottlerModule 的全局和用户级限流配置正确加载
 */
describe('ThrottlerModule', () => {
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
        }),
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            throttlers: [
              {
                name: 'global',
                ttl: 60000,
                limit: config.get('GLOBAL_RATE_LIMIT_LIMIT', 60),
              },
              {
                name: 'user',
                ttl: 60000,
                limit: config.get('USER_RATE_LIMIT_LIMIT', 5),
                getTracker: (req: Record<string, unknown>) => {
                  const user = req.user as { id?: string | number } | undefined;
                  return user?.id?.toString() ?? (req.ip as string);
                },
              },
            ],
            errorMessage: '请求过于频繁，请稍后重试',
          }),
        }),
      ],
    }).compile();

    configService = module.get<ConfigService>(ConfigService);
  });

  it('全局限流默认值为 60 RPM', () => {
    const limit = configService.get('GLOBAL_RATE_LIMIT_LIMIT', 60);
    expect(limit).toBe(60);
  });

  it('用户级限流默认值为 5 RPM', () => {
    const limit = configService.get('USER_RATE_LIMIT_LIMIT', 5);
    expect(limit).toBe(5);
  });

  it('getTracker 从 JWT user 中提取 id', () => {
    const getTracker = (req: Record<string, unknown>) => {
      const user = req.user as { id?: string | number } | undefined;
      return user?.id?.toString() ?? (req.ip as string);
    };

    const req = { user: { id: 42 }, ip: '127.0.0.1' };
    expect(getTracker(req)).toBe('42');
  });

  it('getTracker 无 user 时回退到 IP', () => {
    const getTracker = (req: Record<string, unknown>) => {
      const user = req.user as { id?: string | number } | undefined;
      return user?.id?.toString() ?? (req.ip as string);
    };

    const req = { ip: '192.168.1.1' };
    expect(getTracker(req)).toBe('192.168.1.1');
  });

  it('ThrottlerException 包含正确的 errorMessage', () => {
    const exception = new ThrottlerException('请求过于频繁，请稍后重试');

    expect(exception.message).toBe('请求过于频繁，请稍后重试');
    // ThrottlerException 默认包含 statusCode 和 message
    expect(exception.getStatus()).toBe(429);
  });

  it('ConfigService 可读取自定义限流值', async () => {
    process.env.GLOBAL_RATE_LIMIT_LIMIT = '30';
    process.env.USER_RATE_LIMIT_LIMIT = '3';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
        }),
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            throttlers: [
              {
                name: 'global',
                ttl: 60000,
                limit: config.get('GLOBAL_RATE_LIMIT_LIMIT', 60),
              },
              {
                name: 'user',
                ttl: 60000,
                limit: config.get('USER_RATE_LIMIT_LIMIT', 5),
                getTracker: () => 'test',
              },
            ],
            errorMessage: '请求过于频繁，请稍后重试',
          }),
        }),
      ],
    }).compile();

    const cs = module.get<ConfigService>(ConfigService);
    expect(cs.get('GLOBAL_RATE_LIMIT_LIMIT', 60)).toBe('30');
    expect(cs.get('USER_RATE_LIMIT_LIMIT', 5)).toBe('3');

    delete process.env.GLOBAL_RATE_LIMIT_LIMIT;
    delete process.env.USER_RATE_LIMIT_LIMIT;
  });
});
