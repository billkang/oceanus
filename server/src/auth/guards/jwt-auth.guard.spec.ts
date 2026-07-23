import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;

  const mockJwtService = {
    verify: vi.fn(),
  };

  const createMockContext = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: (): Partial<Request> => ({
          headers,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Token 有效时应通过验证并设置 req.user', () => {
    mockJwtService.verify.mockReturnValue({ sub: 1, username: 'admin' });

    const request = { headers: { authorization: 'Bearer valid-token' } };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(request).toHaveProperty('user');
    expect((request as Record<string, unknown>)['user']).toEqual({ id: 1, username: 'admin' });
    expect(jwtService.verify).toHaveBeenCalledWith('valid-token');
  });

  it('缺少 Authorization 头时应抛出 UnauthorizedException', () => {
    const context = createMockContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('Authorization 头不是 Bearer 格式时应抛出 UnauthorizedException', () => {
    const context = createMockContext({
      authorization: 'Basic base64string',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('Authorization 头格式不完整时应抛出 UnauthorizedException', () => {
    const context = createMockContext({
      authorization: 'Bearer',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('Token 无效时应抛出 UnauthorizedException', () => {
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const context = createMockContext({
      authorization: 'Bearer invalid-token',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('Token 过期时应抛出 UnauthorizedException', () => {
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const context = createMockContext({
      authorization: 'Bearer expired-token',
    });

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
