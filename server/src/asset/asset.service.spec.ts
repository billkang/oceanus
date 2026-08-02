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
      deletedAt: null,
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
      deletedAt: null,
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
              findFirst: vi.fn(),
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
    it('会话所有者应返回资产列表（where 过滤已删资产）', async () => {
      vi.mocked(prisma.session.findFirst).mockResolvedValue({ username: OWNER } as any);
      vi.mocked(prisma.asset.findMany).mockResolvedValue(mockAssets);

      const result = await service.listBySession(10, OWNER);

      expect(prisma.session.findFirst).toHaveBeenCalledWith({
        where: { id: 10, deletedAt: null },
        select: { username: true },
      });
      expect(result).toEqual(mockAssets);
      expect(prisma.asset.findMany).toHaveBeenCalledWith({
        where: { sessionId: 10, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('空会话应返回空数组', async () => {
      vi.mocked(prisma.session.findFirst).mockResolvedValue({ username: OWNER } as any);
      vi.mocked(prisma.asset.findMany).mockResolvedValue([]);

      const result = await service.listBySession(999, OWNER);

      expect(result).toEqual([]);
    });

    it('非会话所有者应抛 404 且不查询资产', async () => {
      vi.mocked(prisma.session.findFirst).mockResolvedValue({ username: 'other' } as any);

      await expect(service.listBySession(10, OWNER)).rejects.toThrow(NotFoundException);
      expect(prisma.asset.findMany).not.toHaveBeenCalled();
    });

    it('会话不存在应抛 404', async () => {
      vi.mocked(prisma.session.findFirst).mockResolvedValue(null);

      await expect(service.listBySession(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('会话已软删应抛 404', async () => {
      vi.mocked(prisma.session.findFirst).mockResolvedValue(null);

      await expect(service.listBySession(10, OWNER)).rejects.toThrow(NotFoundException);
      expect(prisma.asset.findMany).not.toHaveBeenCalled();
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
        deletedAt: null,
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
    it('资产所有者应返回详情（不含 session 投影，where 过滤已删资产）', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset());

      const result = await service.getById(1, OWNER);

      expect(result).toEqual(mockAssets[0]);
      expect(prisma.asset.findFirst).toHaveBeenCalledWith({
        where: { id: 1, deletedAt: null, session: { is: { deletedAt: null } } },
        include: { session: { select: { username: true } } },
      });
    });

    it('所属会话已软删的资产应抛 404（纵深防御：session 软删后资产不可再读）', async () => {
      // 会话被软删（项目删除级联）时，即使资产本身未软删，也不应再可读。
      // Prisma 侧过滤由 where.session.is.deletedAt 承担，mock 返回 null 模拟"查不到"。
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.getById(1, OWNER)).rejects.toThrow(NotFoundException);
      // 断言查询已携带会话软删过滤（防止回归到"只查资产软删"）
      expect(prisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ session: { is: { deletedAt: null } } }),
        }),
      );
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.getById(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('已软删资产应抛 404', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.getById(1, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.getById(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getContent', () => {
    it('资产所有者应返回内容文本', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset());

      const result = await service.getContent(1, OWNER);

      expect(result).toBe(mockAssets[0].content);
      expect(prisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.getContent(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.getContent(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('download', () => {
    it('资产所有者应返回资产标题和内容', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset());

      const result = await service.download(1, OWNER);

      expect(result).toEqual({
        title: '用户登录 PRD',
        content: '# 用户登录\n\n登录功能需求文档...',
        filename: '用户登录 PRD.md',
      });
      expect(prisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('资产不存在时应抛出 NotFoundException', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.download(999, OWNER)).rejects.toThrow(NotFoundException);
    });

    it('非资产所有者应抛 404', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(ownedAsset({ session: { username: 'other' } }));

      await expect(service.download(1, OWNER)).rejects.toThrow(NotFoundException);
    });
  });
});
