import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwtService: JwtService;

  const mockUser = {
    id: 1,
    username: 'admin',
    password: bcrypt.hashSync('oceanus123', 10),
    displayName: 'Admin',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: vi.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: vi.fn().mockResolvedValue('mock-jwt-token'),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('应返回 token 和用户信息（用户名密码正确）', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser);

      const result = await service.login('admin', 'oceanus123');

      expect(result).toHaveProperty('token', 'mock-jwt-token');
      expect(result).toHaveProperty('user');
      expect(result.user).toEqual({
        id: 1,
        username: 'admin',
        displayName: 'Admin',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 1,
        username: 'admin',
      });
    });

    it('当 displayName 为空时应该返回 username', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        ...mockUser,
        displayName: null,
      });

      const result = await service.login('admin', 'oceanus123');

      expect(result.user.displayName).toBe('admin');
    });

    it('用户不存在时应抛出 UnauthorizedException', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(service.login('nonexistent', 'any')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser);

      await expect(service.login('admin', 'wrongpassword')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('用户不活跃时应抛出 UnauthorizedException', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        ...mockUser,
        active: false,
      });

      await expect(service.login('admin', 'oceanus123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('错误信息不应区分"用户不存在"和"密码错误"（防止枚举攻击）', async () => {
      // 用户不存在
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
      const err1 = await service.login('unknown', 'any').catch((e) => e);

      // 密码错误
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser);
      const err2 = await service
        .login('admin', 'wrong')
        .catch((e) => e);

      expect(err1.message).toBe(err2.message);
    });
  });

  describe('getUserById', () => {
    it('应返回用户信息（排除密码）', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 1,
        username: 'admin',
        displayName: 'Admin',
      } as any);

      const result = await service.getUserById(1);

      expect(result).toEqual({
        id: 1,
        username: 'admin',
        displayName: 'Admin',
      });
      expect(result).not.toHaveProperty('password');
    });

    it('用户不存在时应抛出 UnauthorizedException', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(service.getUserById(999)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
