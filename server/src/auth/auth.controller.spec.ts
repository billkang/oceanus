import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    login: vi.fn(),
    getUserById: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: JwtService,
          useValue: { verify: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    const loginDto: LoginDto = {
      username: 'admin',
      password: 'oceanus123',
    };

    it('应调用 authService.login 并返回结果', async () => {
      const expected = {
        token: 'jwt-token',
        user: { id: 1, username: 'admin', displayName: 'Admin' },
      };
      mockAuthService.login.mockResolvedValue(expected);

      const result = await controller.login(loginDto);

      expect(result).toEqual(expected);
      expect(authService.login).toHaveBeenCalledWith('admin', 'oceanus123');
    });

    it('应透传 authService 抛出的异常', async () => {
      mockAuthService.login.mockRejectedValue(new Error('账号或密码错误'));

      await expect(controller.login(loginDto)).rejects.toThrow('账号或密码错误');
    });
  });

  describe('GET /auth/me', () => {
    it('应调用 authService.getUserById 并返回结果', async () => {
      const mockReq = {
        user: { id: 1, username: 'admin' },
      } as unknown as Request;

      const expected = { id: 1, username: 'admin', displayName: 'Admin' };
      mockAuthService.getUserById.mockResolvedValue(expected);

      const result = await controller.getProfile(mockReq);

      expect(result).toEqual(expected);
      expect(authService.getUserById).toHaveBeenCalledWith(1);
    });
  });
});
