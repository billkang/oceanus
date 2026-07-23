import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';

describe('SessionController', () => {
  let controller: SessionController;
  let sessionService: SessionService;

  const mockSessionService = {
    listByProject: vi.fn(),
    getById: vi.fn(),
    getBySdkSessionId: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteBySdkSessionId: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: SessionService, useValue: mockSessionService },
        { provide: JwtService, useValue: { verify: vi.fn() } },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
    sessionService = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /projects/:projectId/sessions', () => {
    it('应返回项目下的会话列表', async () => {
      const expected = [
        { id: 1, sdkSessionId: 'sdk-uuid-1', title: '会话1' },
        { id: 2, sdkSessionId: 'sdk-uuid-2', title: '会话2' },
      ];
      mockSessionService.listByProject.mockResolvedValue(expected);

      const result = await controller.listByProject(1);

      expect(result).toEqual(expected);
      expect(sessionService.listByProject).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /projects/:projectId/sessions', () => {
    it('应使用 SDK session_id 创建新会话', async () => {
      const expected = {
        id: 1,
        sdkSessionId: 'sdk-uuid-new',
        title: '新会话',
      };
      mockSessionService.create.mockResolvedValue(expected);

      const result = await controller.create(1, 'sdk-uuid-new');

      expect(result).toEqual(expected);
      expect(sessionService.create).toHaveBeenCalledWith(1, 'sdk-uuid-new');
    });
  });

  describe('GET /sessions/:sdkSessionId', () => {
    it('应按 sdkSessionId 返回会话详情', async () => {
      const expected = { id: 1, sdkSessionId: 'sdk-uuid-1', title: '会话1' };
      mockSessionService.getBySdkSessionId.mockResolvedValue(expected);

      const result = await controller.getBySdkSessionId('sdk-uuid-1');

      expect(result).toEqual(expected);
      expect(sessionService.getBySdkSessionId).toHaveBeenCalledWith('sdk-uuid-1');
    });
  });

  describe('DELETE /sessions/:sdkSessionId', () => {
    it('应按 sdkSessionId 删除会话并返回成功', async () => {
      mockSessionService.deleteBySdkSessionId.mockResolvedValue(undefined);

      const result = await controller.deleteBySdkSessionId('sdk-uuid-1');

      expect(result).toEqual({ success: true });
      expect(sessionService.deleteBySdkSessionId).toHaveBeenCalledWith('sdk-uuid-1');
    });
  });
});
