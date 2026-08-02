import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { NotFoundException } from '@nestjs/common';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { ProjectService } from '../project/project.service';

describe('SessionController', () => {
  let controller: SessionController;
  let sessionService: SessionService;
  let projectService: ProjectService;

  /** 模拟 JwtAuthGuard 挂载的 req.user */
  const req = (username: string) => ({ user: { id: 1, username } }) as never;

  const mockSessionService = {
    listByProject: vi.fn(),
    getBySdkSessionId: vi.fn(),
    create: vi.fn(),
    deleteBySdkSessionId: vi.fn(),
  };

  const mockProjectService = {
    assertMember: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        { provide: SessionService, useValue: mockSessionService },
        { provide: ProjectService, useValue: mockProjectService },
        { provide: JwtService, useValue: { verify: vi.fn() } },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
    sessionService = module.get<SessionService>(SessionService);
    projectService = module.get<ProjectService>(ProjectService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /projects/:projectName/sessions', () => {
    it('成员应返回当前用户会话列表', async () => {
      const expected = [{ id: 1, sdkSessionId: 'sdk-uuid-1', title: '会话1', username: 'admin' }];
      mockSessionService.listByProject.mockResolvedValue(expected);

      const result = await controller.listByProject('project-a', req('admin'));

      expect(result).toEqual(expected);
      expect(projectService.assertMember).toHaveBeenCalledWith('project-a', 'admin');
      expect(sessionService.listByProject).toHaveBeenCalledWith('project-a', 'admin');
    });

    it('非成员访问抛 404', async () => {
      mockProjectService.assertMember.mockRejectedValue(new NotFoundException('项目不存在'));

      await expect(controller.listByProject('project-a', req('other'))).rejects.toThrow(NotFoundException);
      expect(sessionService.listByProject).not.toHaveBeenCalled();
    });
  });

  describe('GET /sessions/:sdkSessionId', () => {
    it('所有者应返回会话详情', async () => {
      const expected = { id: 1, sdkSessionId: 'sdk-uuid-1', title: '会话1', username: 'admin' };
      mockSessionService.getBySdkSessionId.mockResolvedValue(expected);

      const result = await controller.getBySdkSessionId('sdk-uuid-1', req('admin'));

      expect(result).toEqual(expected);
      expect(sessionService.getBySdkSessionId).toHaveBeenCalledWith('sdk-uuid-1');
    });

    it('非所有者访问抛 404', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: 'sdk-uuid-1',
        username: 'admin',
        project: { projectName: 'project-a' },
      });

      await expect(controller.getBySdkSessionId('sdk-uuid-1', req('other'))).rejects.toThrow(NotFoundException);
    });
  });

  describe('DELETE /sessions/:sdkSessionId', () => {
    it('所有者删除：按 (projectName/username) 推导分区并原子清理', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: 'sdk-uuid-1',
        username: 'admin',
        project: { projectName: 'project-a' },
      });
      mockSessionService.deleteBySdkSessionId.mockResolvedValue(undefined);

      const result = await controller.deleteBySdkSessionId('sdk-uuid-1', req('admin'));

      expect(result).toEqual({ success: true });
      expect(sessionService.deleteBySdkSessionId).toHaveBeenCalledWith('sdk-uuid-1', 'project-a/admin');
    });

    it('非所有者删除抛 404 且不触发删除', async () => {
      mockSessionService.getBySdkSessionId.mockResolvedValue({
        id: 1,
        sdkSessionId: 'sdk-uuid-1',
        username: 'admin',
        project: { projectName: 'project-a' },
      });

      await expect(controller.deleteBySdkSessionId('sdk-uuid-1', req('other'))).rejects.toThrow(NotFoundException);
      expect(sessionService.deleteBySdkSessionId).not.toHaveBeenCalled();
    });
  });
});
