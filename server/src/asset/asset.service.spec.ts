import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AssetService } from './asset.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AssetService', () => {
  let service: AssetService;
  let prisma: PrismaService;

  const OWNER = 'admin';

  const mockAssets = [
    {
      id: 1,
      uuid: 'asset-uuid-1',
      type: 'PRD',
      title: '用户登录 PRD',
      content: '# 用户登录\n\n登录功能需求文档...',
      sessionId: 10,
      projectId: 1,
      createdAt: new Date('2026-07-23'),
      updatedAt: new Date('2026-07-23'),
    },
    {
      id: 2,
      uuid: 'asset-uuid-2',
      type: 'Jira Task',
      title: '登录页 UI 实现',
      content: '## 任务描述\n\n实现登录页面',
      sessionId: 10,
      projectId: null,
      createdAt: new Date('2026-07-23'),
      updatedAt: new Date('2026-07-23'),
    },
  ];

  /** 带 session 投影的资产（assertOwned 的 findUnique include 返回） */
  const ownedAsset = (overrides: Record<string, unknown> = {}) => ({
    ...mockAssets[0],
    session: { username: OWNER },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetService,
        {
          provide: PrismaService,
          useValue: {
            asset: {
              findMany: vi.fn(),
              findUnique: vi.fn(),
              findFirst: vi.fn(),
              create: vi.fn(),
            },
            session: {
              findUnique: vi.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AssetService>(AssetService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listBySession', () => {
    it('会话所有者应返回资产列表', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({ username: OWNER } as any);
      vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets);

      const result = await service.listBySession(10, OWNER);

      expect(prisma.session.findUnique).toHaveBeenCalledWith({
        where: { id: 10 },
        select: { username: true },
      });
      expect(result).toEqual(mockAssets);
      expect(prisma.asset.findMany).toHaveBeenCalledWith({
        where: { sessionId: 10 },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('空会话应返回空数组', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({ username: OWNER } as any);
      vi.mocked(prisma.asset.findMany).mockResolvedValue([]);

      const result = await service.listBySession(999, OWNER);

      expect(result).toEqual([]);
    });

    it('非会话所有者应抛 404 且不查询资产', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({ username: 'other' } as any);

      await expect(service.listBySession(10, OWNER)).rejects.toThrow(NotFoundException);
      expect(prisma.asset.findMany).not.toHaveBeenCalled();
    });

    it('会话不存在应抛 404', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(null);

      await expect(service.listBySession(999, OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('应创建资产并返回', async () => {
      const created = {
        id: 3,
        uuid: 'new-asset-uuid',
        type: 'prd',
        title: 'PRD 标题',
        content: '# PRD\n\n内容',
        sessionId: 10,
        projectId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.asset.create).mockResolvedValue(created);

      const result = await service.create({
        sessionId: 10,
        type: 'prd',
        title: 'PRD 标题',
        content: '# PRD\n\n内容',
      });

      expect(result).toEqual(created);
      expect(prisma.asset.create).toHaveBeenCalledWith({
        data: {
          sessionId: 10,
          projectId: null,
          type: 'prd',
          title: 'PRD 标题',
          content: '# PRD\n\n内容',
        },
      });
    });

    it('创建资产时可指定 projectId', async () => {
      vi.mocked(prisma.asset.create).mockResolvedValue({
        id: 4,
        uuid: 'uuid-4',
        type: 'prd',
        title: '项目 PRD',
        content: '内容',
        sessionId: 10,
        projectId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const result = await service.create({
        sessionId: 10,
        projectId: 1,
        type: 'prd',
        title: '项目 PRD',
        content: '内容',
      });

      expect(result.projectId).toBe(1);
      expect(prisma.asset.create).toHaveBeenCalledWith({
        data: {
          sessionId: 10,
          projectId: 1,
          type: 'prd',
          title: '项目 PRD',
          content: '内容',
        },
      });
    });
  });

  describe('getById', () => {
    it('资产所有者应返回详情（不含 session 投影）', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset());

      const result = await service.getById(1, OWNER);

      expect(result).toEqual(mockAssets[0]);
      expect(prisma.asset.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { session: { select: { username: true } } },
      });
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

      await expect(service.getById(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.getById(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContent', () => {
    it('资产所有者应返回内容文本', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset());

      const result = await service.getContent(1, OWNER);

      expect(result).toBe(mockAssets[0].content);
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

      await expect(service.getContent(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.getContent(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('download', () => {
    it('资产所有者应返回资产标题和内容', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset());

      const result = await service.download(1, OWNER);

      expect(result).toEqual({
        title: '用户登录 PRD',
        content: '# 用户登录\n\n登录功能需求文档...',
        filename: '用户登录 PRD.md',
      });
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(null);

      await expect(service.download(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findUnique).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.download(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });
});
