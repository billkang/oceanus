import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

describe('SessionService', () => {
  let service: SessionService;
  let prisma: PrismaService;
  let workspace: WorkspaceService;

  const now = new Date('2026-07-23T10:00:00Z');

  const mockSession = {
    id: 1,
    sdkSessionId: 'sdk-uuid-abc',
    title: '新会话',
    status: 'active',
    username: 'admin',
    lastMessageAt: null,
    projectId: 1,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    project: { id: 1, projectName: 'project-a', displayName: '项目A' },
  };

  beforeEach(async () => {
    workspace = {
      moveToTrash: vi.fn(),
      paths: { sessionDir: vi.fn().mockReturnValue('/projects/project-a/requirements/private/admin/sdk-uuid-abc') },
    } as unknown as WorkspaceService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        {
          provide: PrismaService,
          useValue: {
            session: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
            },
            sessionEntry: {
              updateMany: vi.fn(),
            },
            asset: {
              updateMany: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
        { provide: WorkspaceService, useValue: workspace },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listByProject', () => {
    it('按 projectName + username 过滤当前用户会话', async () => {
      vi.spyOn(prisma.session, 'findMany').mockResolvedValue([mockSession as never]);

      const result = await service.listByProject('project-a', 'admin');

      expect(result).toHaveLength(1);
      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { project: { projectName: 'project-a' }, username: 'admin', deletedAt: null },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: { project: { select: { projectName: true, displayName: true } } },
      });
    });

    it('过滤已删会话（where 含 deletedAt: null）', async () => {
      vi.spyOn(prisma.session, 'findMany').mockResolvedValue([mockSession as never]);

      await service.listByProject('project-a', 'admin');

      expect(prisma.session.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('无会话时应返回空数组', async () => {
      vi.spyOn(prisma.session, 'findMany').mockResolvedValue([]);

      const result = await service.listByProject('project-a', 'other');

      expect(result).toEqual([]);
    });
  });

  describe('getBySdkSessionId', () => {
    it('应按 sdkSessionId 返回会话（含项目）', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSession as never);

      const result = await service.getBySdkSessionId('sdk-uuid-abc');

      expect(result).toHaveProperty('sdkSessionId', 'sdk-uuid-abc');
      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { sdkSessionId: 'sdk-uuid-abc' },
        include: { project: true },
      });
    });

    it('sdkSessionId 不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.getBySdkSessionId('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('已软删会话应视为不存在（404）', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue({
        ...mockSession,
        deletedAt: new Date('2026-07-24T00:00:00Z'),
      } as never);

      await expect(service.getBySdkSessionId('sdk-uuid-abc')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('创建会话记录 username 归属，不再写 filePath', async () => {
      const created = { id: 3, sdkSessionId: 'sdk-new', title: '新会话', username: 'admin', projectId: 1 };
      vi.spyOn(prisma.session, 'create').mockResolvedValue(created as never);

      const result = await service.create(1, 'sdk-new', 'admin');

      expect(result).toHaveProperty('username', 'admin');
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: { projectId: 1, sdkSessionId: 'sdk-new', title: '新会话', username: 'admin' },
      });
    });
  });

  describe('touch', () => {
    it('更新 lastMessageAt 为当前时间', async () => {
      vi.spyOn(prisma.session, 'update').mockResolvedValue(mockSession as never);

      await service.touch('sdk-uuid-abc');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { sdkSessionId: 'sdk-uuid-abc' },
        data: { lastMessageAt: expect.any(Date) },
      });
    });
  });

  describe('deleteBySdkSessionId', () => {
    it('应软删级联 SessionEntry/Asset/Session 并将会话目录移入回收站', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSession as never);
      vi.mocked(prisma.$transaction).mockResolvedValue([]);
      vi.spyOn(prisma.sessionEntry, 'updateMany').mockResolvedValue({ count: 3 });
      vi.spyOn(prisma.asset, 'updateMany').mockResolvedValue({ count: 2 });
      vi.spyOn(prisma.session, 'update').mockResolvedValue(mockSession as never);
      const moveSpy = vi.spyOn(workspace, 'moveToTrash').mockResolvedValue('/trash/x');

      const result = await service.deleteBySdkSessionId('sdk-uuid-abc', 'project-a/admin');

      expect(result).toHaveProperty('sdkSessionId', 'sdk-uuid-abc');
      expect(prisma.sessionEntry.updateMany).toHaveBeenCalledWith({
        where: { partitionKey: 'project-a/admin', sessionId: 'sdk-uuid-abc', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.asset.updateMany).toHaveBeenCalledWith({
        where: { sessionId: 1, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { sdkSessionId: 'sdk-uuid-abc' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(moveSpy).toHaveBeenCalledWith(expect.stringContaining('sdk-uuid-abc'));
    });

    it('回收站移入失败仅记日志，不阻断删除', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSession as never);
      vi.mocked(prisma.$transaction).mockResolvedValue([]);
      vi.spyOn(prisma.sessionEntry, 'updateMany').mockResolvedValue({ count: 0 });
      vi.spyOn(prisma.asset, 'updateMany').mockResolvedValue({ count: 0 });
      vi.spyOn(prisma.session, 'update').mockResolvedValue(mockSession as never);
      vi.spyOn(workspace, 'moveToTrash').mockRejectedValue(new Error('rename ENOENT'));

      await expect(service.deleteBySdkSessionId('sdk-uuid-abc', 'project-a/admin')).resolves.toBeDefined();
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('回收站'));
    });

    it('会话不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.deleteBySdkSessionId('non-existent', 'project-a/admin')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateTitle', () => {
    it('应更新会话标题', async () => {
      vi.spyOn(prisma.session, 'update').mockResolvedValue({ ...mockSession, title: '新标题' } as never);

      await service.updateTitle(1, '新标题');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { title: '新标题' },
      });
    });
  });
});
