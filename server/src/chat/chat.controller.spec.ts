import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { ThrottlerModule } from '@nestjs/throttler';
import { ModelRegistryService } from '../common/model-registry/model-registry.service';
import { SessionService } from '../session/session.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: ChatService;

  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockChatService = {
    sendAndStream: vi.fn().mockResolvedValue(undefined),
    confirmAndStream: vi.fn().mockResolvedValue(undefined),
    cancelResponse: vi.fn().mockResolvedValue(undefined),
    getSessionMessages: vi.fn(),
  };

  const mockSessionService = {
    getBySdkSessionId: vi.fn(),
  };

  const mockModelRegistry = {
    listModels: vi.fn().mockReturnValue([
      { name: 'deepseek', displayName: 'DeepSeek', default: true },
      { name: 'kimi', displayName: 'Kimi K2', default: false },
    ]),
  };

  const mockJwtService = {
    verify: vi.fn(),
  };

  const mockResponse = () => ({
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  });

  /** 模拟 req.user（JwtAuthGuard 注入的登录用户） */
  const mockRequest = (username = 'admin') => ({ user: { id: 1, username } }) as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'global', ttl: 60000, limit: 100 }] })],
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        { provide: SessionService, useValue: mockSessionService },
        { provide: Logger, useValue: mockLogger },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ModelRegistryService, useValue: mockModelRegistry },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    chatService = module.get<ChatService>(ChatService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/chat — action: message', () => {
    it('发送消息（无 sessionId = 首条）', async () => {
      await controller.chat(
        { action: 'message', content: '你好', projectName: 'project-a' },
        mockRequest(),
        mockResponse() as any,
      );

      expect(chatService.sendAndStream).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '你好',
          projectName: 'project-a',
          username: 'admin',
          sdkSessionId: undefined,
          onEvent: expect.any(Function),
        }),
      );
    });

    it('发送消息（有 sessionId = 续传）', async () => {
      await controller.chat(
        { action: 'message', content: '继续', sessionId: 'sdk-uuid-abc' },
        mockRequest(),
        mockResponse() as any,
      );

      expect(chatService.sendAndStream).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '继续',
          sdkSessionId: 'sdk-uuid-abc',
          username: 'admin',
          onEvent: expect.any(Function),
        }),
      );
    });

    it('action=message 缺少 content 时应抛出 400', async () => {
      await expect(
        controller.chat({ action: 'message' as any, sessionId: 'sdk-uuid' }, mockRequest(), mockResponse() as any),
      ).rejects.toThrow();
    });
  });

  describe('POST /api/v1/chat — action: confirm', () => {
    it('确认选择应调用 confirmAndStream', async () => {
      await controller.chat(
        { action: 'confirm', sessionId: 'sdk-uuid-abc', confirmOption: '方案A' },
        mockRequest(),
        mockResponse() as any,
      );

      expect(chatService.confirmAndStream).toHaveBeenCalledWith(
        expect.objectContaining({
          sdkSessionId: 'sdk-uuid-abc',
          confirmOption: '方案A',
          username: 'admin',
          onEvent: expect.any(Function),
        }),
      );
    });

    it('action=confirm 缺少 confirmOption 时应抛出 400', async () => {
      await expect(
        controller.chat({ action: 'confirm' as any, sessionId: 'sdk-uuid' }, mockRequest(), mockResponse() as any),
      ).rejects.toThrow();
    });
  });

  describe('POST /api/v1/chat — action: cancel', () => {
    it('取消应调用 cancelResponse', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        username: 'admin',
        project: { projectName: 'project-a' },
      });
      await controller.chat({ action: 'cancel', sessionId: 'sdk-uuid-abc' }, mockRequest(), mockResponse() as any);

      expect(chatService.cancelResponse).toHaveBeenCalledWith('sdk-uuid-abc');
    });

    it('取消非所有者会话应拒绝并发送 SSE error（不调用 cancelResponse）', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        username: 'other',
        project: { projectName: 'project-a' },
      });
      const res = mockResponse() as any;
      await controller.chat({ action: 'cancel', sessionId: 'sdk-uuid-abc' }, mockRequest('admin'), res);

      expect(chatService.cancelResponse).not.toHaveBeenCalled();
      const writes = res.write.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(writes.some((w: string) => w.includes('event: error'))).toBe(true);
    });

    it('action=cancel 缺少 sessionId 时应抛出 400', async () => {
      await expect(
        controller.chat({ action: 'cancel' as any }, mockRequest(), mockResponse() as any),
      ).rejects.toThrow();
    });
  });

  describe('POST /api/v1/chat — 无效 action', () => {
    it('未知 action 应抛出 400', async () => {
      await expect(
        controller.chat({ action: 'invalid' as any }, mockRequest(), mockResponse() as any),
      ).rejects.toThrow();
    });
  });

  describe('POST /api/v1/chat — model 参数透传', () => {
    it('message 请求带 model 时透传至 sendAndStream', async () => {
      await controller.chat(
        { action: 'message', content: '你好', model: 'kimi' },
        mockRequest(),
        mockResponse() as any,
      );

      expect(chatService.sendAndStream).toHaveBeenCalledWith(
        expect.objectContaining({ content: '你好', model: 'kimi', username: 'admin' }),
      );
    });

    it('confirm 请求带 model 时透传至 confirmAndStream', async () => {
      await controller.chat(
        { action: 'confirm', sessionId: 'sdk-uuid-abc', confirmOption: '方案A', model: 'kimi' },
        mockRequest(),
        mockResponse() as any,
      );

      expect(chatService.confirmAndStream).toHaveBeenCalledWith(
        expect.objectContaining({
          sdkSessionId: 'sdk-uuid-abc',
          confirmOption: '方案A',
          model: 'kimi',
          username: 'admin',
        }),
      );
    });

    it('未知 model 应抛出 400（错误信息含可用列表）', async () => {
      await expect(
        controller.chat({ action: 'message', content: '你好', model: 'unknown' }, mockRequest(), mockResponse() as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/models', () => {
    it('应返回注册表模型列表', async () => {
      const result = await controller.getModels();

      expect(result).toEqual(mockModelRegistry.listModels());
    });
  });

  describe('GET /sessions/:id/messages', () => {
    it('应返回历史消息（校验会话归属）', async () => {
      const mockMessages = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }];
      mockChatService.getSessionMessages.mockResolvedValue(mockMessages);

      const result = await controller.getMessages('sdk-uuid-abc', mockRequest());

      expect(result).toEqual(mockMessages);
      expect(chatService.getSessionMessages).toHaveBeenCalledWith('sdk-uuid-abc', 'admin');
    });
  });
});
