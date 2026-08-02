import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ProjectService } from './project.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { SkillsProvider } from '../skills/skills-provider.interface';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: PrismaService;
  let workspace: WorkspaceService;
  let skills: SkillsProvider;

  const mockLogger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;

  const mockProject = {
    id: 1,
    uuid: 'uuid-1',
    displayName: '项目A',
    projectName: 'project-a',
    description: '描述A',
    active: true,
    deletedAt: null,
    createdAt: new Date('2026-07-22'),
    updatedAt: new Date('2026-07-23'),
    _count: { sessions: 3 },
  };

  beforeEach(async () => {
    workspace = {
      ensureFreshProjectDir: vi.fn().mockResolvedValue(undefined),
      createSkeleton: vi.fn().mockResolvedValue(undefined),
      moveToTrash: vi.fn().mockResolvedValue('/trash/project-a'),
      paths: {
        projectRoot: vi.fn((proj: string) => `/projects/${proj}`),
      },
    } as unknown as WorkspaceService;

    skills = {
      install: vi.fn().mockResolvedValue(undefined),
      isOutdated: vi.fn().mockResolvedValue(false),
      currentVersion: vi.fn().mockResolvedValue('1.0.0'),
    } as unknown as SkillsProvider;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            projectMember: {
              findUnique: vi.fn(),
              create: vi.fn(),
              updateMany: vi.fn(),
            },
            session: {
              findMany: vi.fn(),
              updateMany: vi.fn(),
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
        { provide: Logger, useValue: mockLogger },
        { provide: WorkspaceService, useValue: workspace },
        { provide: SkillsProvider, useValue: skills },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('只返回当前用户是成员的项目，并带出角色', async () => {
      const projects = [
        { ...mockProject, members: [{ role: 'owner' }] },
        {
          ...mockProject,
          id: 2,
          projectName: 'project-b',
          members: [{ role: 'member' }],
          _count: { sessions: 0 },
        },
      ];
      vi.spyOn(prisma.project, 'findMany').mockResolvedValue(projects as never);

      const result = await service.list('admin');

      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { active: true, deletedAt: null, members: { some: { username: 'admin' } } },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: { select: { sessions: true } },
          members: { where: { username: 'admin' }, select: { role: true } },
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('role', 'owner');
      expect(result[0]).toHaveProperty('sessionCount', 3);
      expect(result[1]).toHaveProperty('role', 'member');
    });

    it('非成员（无项目）时应返回空数组', async () => {
      vi.spyOn(prisma.project, 'findMany').mockResolvedValue([]);

      const result = await service.list('other');

      expect(result).toEqual([]);
    });
  });

  describe('assertMember', () => {
    it('成员存在时正常通过', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.assertMember('project-a', 'admin')).resolves.toBeUndefined();
      expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
        where: { projectId_username: { projectId: 1, username: 'admin' } },
      });
    });

    it('非成员统一抛 404', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue(null);

      await expect(service.assertMember('project-a', 'other')).rejects.toThrow(NotFoundException);
    });

    it('项目不存在时抛 404', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);

      await expect(service.assertMember('missing', 'admin')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getById', () => {
    it('成员应返回项目详情', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      const result = await service.getById('project-a', 'admin');

      expect(result).toHaveProperty('sessionCount', 3);
      expect(result).toHaveProperty('projectName', 'project-a');
    });

    it('非成员访问抛 404', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue(null);

      await expect(service.getById('project-a', 'other')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (FS 先行)', () => {
    it('先建骨架后 DB，skills 失败不阻断', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
      const fresh = vi.spyOn(workspace, 'ensureFreshProjectDir').mockResolvedValue(undefined);
      const skeleton = vi.spyOn(workspace, 'createSkeleton').mockResolvedValue(undefined);
      const created = { ...mockProject, id: 9, displayName: 'P', projectName: 'p-1', _count: { sessions: 0 } };
      const tx = {
        project: { create: vi.fn().mockResolvedValue(created) },
        projectMember: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));
      vi.spyOn(skills, 'install').mockRejectedValue(new Error('cli down'));

      await expect(service.create({ displayName: 'P', projectName: 'p-1' }, 'admin')).resolves.toBeDefined();

      expect(prisma.project.findFirst).toHaveBeenCalledWith({
        where: { projectName: 'p-1', deletedAt: null },
        select: { id: true },
      });
      expect(fresh).toHaveBeenCalledWith('p-1');
      expect(skeleton).toHaveBeenCalledWith('p-1');
      expect(tx.project.create).toHaveBeenCalled();
      expect(tx.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 9, username: 'admin', role: 'owner' },
      });
      expect(skills.install).toHaveBeenCalled();
    });

    it('事务内创建项目 + 自动 owner 成员', async () => {
      const dto = { displayName: '新项目', projectName: 'Project-A', description: '描述' };
      const created = {
        ...mockProject,
        id: 3,
        displayName: '新项目',
        projectName: 'Project-A',
        _count: { sessions: 0 },
      };
      const tx = {
        project: { create: vi.fn().mockResolvedValue(created) },
        projectMember: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      };
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      const result = await service.create(dto, 'admin');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(tx.project.create).toHaveBeenCalledWith({
        data: { displayName: '新项目', projectName: 'Project-A', description: '描述' },
        include: { _count: { select: { sessions: true } } },
      });
      expect(tx.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 3, username: 'admin', role: 'owner' },
      });
      expect(result).toHaveProperty('sessionCount', 0);
    });

    it('description 为空字符串时应存为 null', async () => {
      const dto = { displayName: '新项目', projectName: 'project-a', description: '' };
      const created = { ...mockProject, id: 4, displayName: '新项目', _count: { sessions: 0 } };
      const tx = {
        project: { create: vi.fn().mockResolvedValue(created) },
        projectMember: { create: vi.fn().mockResolvedValue({ id: 1 }) },
      };
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto, 'admin');

      expect(tx.project.create).toHaveBeenCalledWith({
        data: { displayName: '新项目', projectName: 'project-a', description: null },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('projectName 已存在（未软删）时抛 ConflictException 且不触碰 FS', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue({ id: 5 } as never);

      await expect(service.create({ displayName: 'P', projectName: 'dup' }, 'admin')).rejects.toThrow(
        ConflictException,
      );
      expect(workspace.createSkeleton).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('骨架失败时不触碰 DB', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
      vi.spyOn(workspace, 'createSkeleton').mockRejectedValue(new Error('disk full'));

      await expect(service.create({ displayName: 'P', projectName: 'p-2' }, 'admin')).rejects.toThrow('disk full');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('owner 可编辑项目（projectName 不可改）', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      const updated = { ...mockProject, displayName: '新名称' };
      vi.spyOn(prisma.project, 'update').mockResolvedValue(updated as never);

      const result = await service.update('project-a', 'admin', { displayName: '新名称' });

      expect(result).toHaveProperty('displayName', '新名称');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { displayName: '新名称', description: undefined },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('部分更新：仅提供 displayName 时不应把 description 置空（保留原值）', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.spyOn(prisma.project, 'update').mockResolvedValue(mockProject as never);

      await service.update('project-a', 'admin', { displayName: '新名称' });

      const call = (prisma.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.description).toBeUndefined();
      expect(call.data.displayName).toBe('新名称');
    });

    it('部分更新：提供 description 时正常写入', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.spyOn(prisma.project, 'update').mockResolvedValue(mockProject as never);

      await service.update('project-a', 'admin', { displayName: '新名称', description: '新描述' });

      const call = (prisma.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.description).toBe('新描述');
    });

    it('非 owner 编辑抛 404 且不触发更新', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.update('project-a', 'member1', { displayName: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe('delete (软删级联)', () => {
    it('owner 删除：按本项目会话 id 级联 sessionEntry、按 session 关系级联 asset，目录进回收站', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      const tx = {
        session: {
          findMany: vi.fn().mockResolvedValue([{ sdkSessionId: 'sess-1' }, { sdkSessionId: 'sess-2' }]),
          updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        projectMember: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        sessionEntry: { updateMany: vi.fn().mockResolvedValue({ count: 4 }) },
        asset: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
        project: { update: vi.fn().mockResolvedValue({ id: 1 }) },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) => {
        return (cb as (t: typeof tx) => Promise<unknown>)(tx as never);
      });
      const move = vi.spyOn(workspace, 'moveToTrash').mockResolvedValue('/trash/project-a');

      await service.delete('project-a', 'admin');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // 会话 id 先按项目抓取（用于 sessionEntry 精确级联）
      expect(tx.session.findMany).toHaveBeenCalledWith({
        where: { projectId: 1, deletedAt: null },
        select: { sdkSessionId: true },
      });
      expect(tx.session.updateMany).toHaveBeenCalledWith({
        where: { projectId: 1, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(tx.projectMember.updateMany).toHaveBeenCalledWith({
        where: { projectId: 1, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      // sessionEntry 按本项目会话 id 级联（partitionKey 前缀仅作防御，避免跨项目前缀误伤）
      expect(tx.sessionEntry.updateMany).toHaveBeenCalledWith({
        where: { sessionId: { in: ['sess-1', 'sess-2'] }, partitionKey: { startsWith: 'project-a/' } },
        data: { deletedAt: expect.any(Date) },
      });
      // asset 按 session 关系级联（资产创建时不落 projectId，不能按 projectId 过滤）
      expect(tx.asset.updateMany).toHaveBeenCalledWith({
        where: { session: { projectId: 1 }, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(tx.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { deletedAt: expect.any(Date) },
      });
      expect(move).toHaveBeenCalledWith('/projects/project-a');
    });

    it('目录移入回收站失败（rename 失败）不阻断 DB 软删', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.mocked(prisma.$transaction).mockResolvedValue([]);
      vi.spyOn(workspace, 'moveToTrash').mockRejectedValue(new Error('perm'));

      await expect(service.delete('project-a', 'admin')).resolves.toBeUndefined();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('非 owner 删除抛 404 且不触发删除', async () => {
      vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.delete('project-a', 'member1')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
