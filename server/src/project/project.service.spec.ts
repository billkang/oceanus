import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectService } from './project.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: PrismaService;

  const mockProject = {
    id: 1,
    uuid: 'uuid-1',
    displayName: '项目A',
    projectName: 'project-a',
    description: '描述A',
    active: true,
    createdAt: new Date('2026-07-22'),
    updatedAt: new Date('2026-07-23'),
    _count: { sessions: 3 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        {
          provide: PrismaService,
          useValue: {
            project: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              create: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            projectMember: {
              findUnique: vi.fn(),
              create: vi.fn(),
            },
            sessionEntry: {
              deleteMany: vi.fn(),
            },
            $transaction: vi.fn(),
          },
        },
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
        where: { active: true, members: { some: { username: 'admin' } } },
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
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.assertMember('project-a', 'admin')).resolves.toBeUndefined();
      expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
        where: { projectId_username: { projectId: 1, username: 'admin' } },
      });
    });

    it('非成员统一抛 404', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue(null);

      await expect(service.assertMember('project-a', 'other')).rejects.toThrow(NotFoundException);
    });

    it('项目不存在时抛 404', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(null);

      await expect(service.assertMember('missing', 'admin')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getById', () => {
    it('成员应返回项目详情', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      const result = await service.getById('project-a', 'admin');

      expect(result).toHaveProperty('sessionCount', 3);
      expect(result).toHaveProperty('projectName', 'project-a');
    });

    it('非成员访问抛 404', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue(null);

      await expect(service.getById('project-a', 'other')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
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
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await service.create(dto, 'admin');

      expect(tx.project.create).toHaveBeenCalledWith({
        data: { displayName: '新项目', projectName: 'project-a', description: null },
        include: { _count: { select: { sessions: true } } },
      });
    });
  });

  describe('update', () => {
    it('owner 可编辑项目（projectName 不可改）', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      const updated = { ...mockProject, displayName: '新名称' };
      vi.spyOn(prisma.project, 'update').mockResolvedValue(updated as never);

      const result = await service.update('project-a', 'admin', { displayName: '新名称' });

      expect(result).toHaveProperty('displayName', '新名称');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { projectName: 'project-a' },
        data: { displayName: '新名称', description: undefined },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('部分更新：仅提供 displayName 时不应把 description 置空（保留原值）', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.spyOn(prisma.project, 'update').mockResolvedValue(mockProject as never);

      await service.update('project-a', 'admin', { displayName: '新名称' });

      const call = (prisma.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.description).toBeUndefined();
      expect(call.data.displayName).toBe('新名称');
    });

    it('部分更新：提供 description 时正常写入', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.spyOn(prisma.project, 'update').mockResolvedValue(mockProject as never);

      await service.update('project-a', 'admin', { displayName: '新名称', description: '新描述' });

      const call = (prisma.project.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.data.description).toBe('新描述');
    });

    it('非 owner 编辑抛 404 且不触发更新', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.update('project-a', 'member1', { displayName: 'x' })).rejects.toThrow(NotFoundException);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('owner 删除：先清 SessionEntry 再删项目（$transaction）', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
      vi.spyOn(prisma.sessionEntry, 'deleteMany').mockResolvedValue({ count: 5 } as never);
      vi.spyOn(prisma.project, 'delete').mockResolvedValue(mockProject as never);
      vi.mocked(prisma.$transaction).mockResolvedValue([]);

      await service.delete('project-a', 'admin');

      expect(prisma.sessionEntry.deleteMany).toHaveBeenCalledWith({
        where: { partitionKey: { startsWith: 'project-a/' } },
      });
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { projectName: 'project-a' } });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('非 owner 删除抛 404 且不触发删除', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProject as never);
      vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'member' } as never);

      await expect(service.delete('project-a', 'member1')).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
