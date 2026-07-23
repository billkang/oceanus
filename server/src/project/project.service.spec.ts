import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectService } from './project.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: PrismaService;

  const mockProjects = [
    {
      id: 1,
      uuid: 'uuid-1',
      name: '项目A',
      description: '描述A',
      active: true,
      createdAt: new Date('2026-07-22'),
      updatedAt: new Date('2026-07-23'),
      _count: { sessions: 3 },
    },
    {
      id: 2,
      uuid: 'uuid-2',
      name: '项目B',
      description: null,
      active: true,
      createdAt: new Date('2026-07-21'),
      updatedAt: new Date('2026-07-22'),
      _count: { sessions: 0 },
    },
  ];

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
    it('应返回项目列表（含会话数量，按更新时间倒序）', async () => {
      vi.spyOn(prisma.project, 'findMany').mockResolvedValue(mockProjects);

      const result = await service.list();

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('sessionCount', 3);
      expect(result[0]).toHaveProperty('name', '项目A');
      expect(prisma.project.findMany).toHaveBeenCalledWith({
        where: { active: true },
        orderBy: { updatedAt: 'desc' },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('无项目时应返回空数组', async () => {
      vi.spyOn(prisma.project, 'findMany').mockResolvedValue([]);

      const result = await service.list();

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('应返回项目详情（含会话数量）', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProjects[0]);

      const result = await service.getById(1);

      expect(result).toHaveProperty('sessionCount', 3);
      expect(result).toHaveProperty('name', '项目A');
    });

    it('项目不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(null);

      await expect(service.getById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('应创建项目并返回（含会话数量 0）', async () => {
      const dto = { name: '新项目', description: '描述' };
      const created = {
        id: 3,
        uuid: 'uuid-3',
        name: '新项目',
        description: '描述',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { sessions: 0 },
      };
      vi.spyOn(prisma.project, 'create').mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toHaveProperty('name', '新项目');
      expect(result).toHaveProperty('sessionCount', 0);
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: { name: '新项目', description: '描述' },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('description 为空字符串时应存为 null', async () => {
      const dto = { name: '新项目', description: '' };
      const created = {
        id: 4,
        uuid: 'uuid-4',
        name: '新项目',
        description: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { sessions: 0 },
      };
      vi.spyOn(prisma.project, 'create').mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toHaveProperty('name', '新项目');
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: { name: '新项目', description: null },
        include: { _count: { select: { sessions: true } } },
      });
    });
  });

  describe('update', () => {
    it('应更新项目名称和描述', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProjects[0]);
      const updated = {
        ...mockProjects[0],
        name: '新名称',
        description: '新描述',
        _count: { sessions: 3 },
      };
      vi.spyOn(prisma.project, 'update').mockResolvedValue(updated);

      const result = await service.update(1, { name: '新名称', description: '新描述' });

      expect(result).toHaveProperty('name', '新名称');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: '新名称', description: '新描述' },
        include: { _count: { select: { sessions: true } } },
      });
    });

    it('项目不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(null);

      await expect(service.update(999, { name: '新名称' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('应删除项目', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(mockProjects[0]);
      vi.spyOn(prisma.project, 'delete').mockResolvedValue(mockProjects[0]);

      await service.delete(1);

      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('项目不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.project, 'findUnique').mockResolvedValue(null);

      await expect(service.delete(999)).rejects.toThrow(NotFoundException);
    });
  });
});
