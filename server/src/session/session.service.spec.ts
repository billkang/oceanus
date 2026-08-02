import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: PrismaService;

  const now = new Date('2026-07-23T10:00:00Z');

  const mockSession = {
    id: 1,
    sdkSessionId: 'sdk-uuid-abc',
    title: '新会话',
    status: 'active',
    username: 'admin',
    lastMessageAt: null,
    projectId: 1,
    createdAt: now,
    updatedAt: now,
    project: { id: 1, projectName: 'project-a', displayName: '项目A' },
  };

  beforeEach(async () => {
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
              delete: vi.fn(),
            },
            sessionEntry: {
              deleteMany: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
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
        where: { project: { projectName: 'project-a' }, username: 'admin' },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: { project: { select: { projectName: true, displayName: true } } },
      });
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
    it('应原子清理 SessionEntry 并删除会话（$transaction）', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSession as never);
      vi.mocked(prisma.$transaction).mockResolvedValue([]);
      vi.spyOn(prisma.sessionEntry, 'deleteMany').mockResolvedValue({ count: 2 });
      vi.spyOn(prisma.session, 'delete').mockResolvedValue(mockSession as never);

      const result = await service.deleteBySdkSessionId('sdk-uuid-abc', 'project-a/admin');

      expect(result).toHaveProperty('sdkSessionId', 'sdk-uuid-abc');
      expect(prisma.sessionEntry.deleteMany).toHaveBeenCalledWith({
        where: { partitionKey: 'project-a/admin', sessionId: 'sdk-uuid-abc' },
      });
      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { sdkSessionId: 'sdk-uuid-abc' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
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
