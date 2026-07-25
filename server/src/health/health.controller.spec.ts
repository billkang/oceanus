import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const mockPrismaService = {} as any;

  const mockHealthCheckResult = {
    status: 'ok' as const,
    info: { database: { status: 'up' } },
    error: {},
    details: { database: { status: 'up' } },
  };

  const mockHealthCheckService = {
    check: vi.fn(),
  };

  const mockPrismaHealthIndicator = {
    pingCheck: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: mockHealthCheckService },
        { provide: PrismaHealthIndicator, useValue: mockPrismaHealthIndicator },
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('数据库可用时应返回 ok 状态', async () => {
      mockPrismaHealthIndicator.pingCheck.mockReturnValue('database');
      mockHealthCheckService.check.mockResolvedValue(mockHealthCheckResult);

      const result = await controller.check();

      expect(result).toEqual(mockHealthCheckResult);
      expect(result.status).toBe('ok');
      expect(result.info?.database?.status).toBe('up');
      expect(mockHealthCheckService.check).toHaveBeenCalledWith([expect.any(Function)]);
    });

    it('数据库不可用时应返回 error 状态', async () => {
      const errorResult = {
        status: 'error' as const,
        info: {},
        error: { database: { status: 'down', message: 'timeout' } },
        details: { database: { status: 'down', message: 'timeout' } },
      };
      mockPrismaHealthIndicator.pingCheck.mockReturnValue('database');
      mockHealthCheckService.check.mockResolvedValue(errorResult);

      const result = await controller.check();

      expect(result).toEqual(errorResult);
      expect(result.status).toBe('error');
    });
  });
});
