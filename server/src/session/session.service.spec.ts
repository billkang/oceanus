import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'node:path';

// mock fs 模块避免 ESM spy 限制
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
import * as fs from 'node:fs';

describe('SessionService', () => {
  let service: SessionService;
  let prisma: PrismaService;

  const now = new Date('2026-07-23T10:00:00Z');
  const later = new Date('2026-07-23T11:00:00Z');

  const mockSessions = [
    {
      id: 1,
      sdkSessionId: 'sdk-uuid-abc',
      title: '新会话',
      status: 'active',
      filePath: 'data/sessions/1/sdk-uuid-abc.jsonl',
      lastMessageAt: later,
      projectId: 1,
      createdAt: now,
      updatedAt: later,
      project: { id: 1, name: '项目A' },
    },
    {
      id: 2,
      sdkSessionId: 'sdk-uuid-xyz',
      title: '旧会话',
      status: 'active',
      filePath: 'data/sessions/1/sdk-uuid-xyz.jsonl',
      lastMessageAt: now,
      projectId: 1,
      createdAt: new Date('2026-07-22T09:00:00Z'),
      updatedAt: now,
      project: { id: 1, name: '项目A' },
    },
  ];

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
    it('应返回项目下的会话列表（按最后消息时间倒序）', async () => {
      vi.spyOn(prisma.session, 'findMany').mockResolvedValue(mockSessions);

      const result = await service.listByProject(1);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('title', '新会话');
      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { projectId: 1 },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      });
    });

    it('无会话时应返回空数组', async () => {
      vi.spyOn(prisma.session, 'findMany').mockResolvedValue([]);

      const result = await service.listByProject(1);

      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('应返回会话详情', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);

      const result = await service.getById(1);

      expect(result).toHaveProperty('title', '新会话');
      expect(result).toHaveProperty('sdkSessionId', 'sdk-uuid-abc');
    });

    it('会话不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.getById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getBySdkSessionId', () => {
    it('应按 sdkSessionId 返回会话', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);

      const result = await service.getBySdkSessionId('sdk-uuid-abc');

      expect(result).toHaveProperty('sdkSessionId', 'sdk-uuid-abc');
      expect(result).toHaveProperty('title', '新会话');
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
    const sdkSessionId = 'sdk-uuid-new-123';

    it('应使用 SDK session_id 创建新会话', async () => {
      const created = {
        id: 3,
        sdkSessionId,
        title: '新会话',
        status: 'active',
        filePath: `data/sessions/1/${sdkSessionId}.jsonl`,
        lastMessageAt: null,
        projectId: 1,
        createdAt: now,
        updatedAt: now,
      };
      vi.spyOn(prisma.session, 'create').mockResolvedValue(created);

      const result = await service.create(1, sdkSessionId);

      expect(result).toHaveProperty('sdkSessionId', sdkSessionId);
      expect(result).toHaveProperty('filePath', `data/sessions/1/${sdkSessionId}.jsonl`);
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: {
          projectId: 1,
          sdkSessionId,
          title: '新会话',
          filePath: `data/sessions/1/${sdkSessionId}.jsonl`,
        },
      });
    });

    it('生成的 filePath 格式应为 data/sessions/{projectId}/{sdkSessionId}.jsonl', async () => {
      const created = {
        id: 4,
        sdkSessionId,
        title: '新会话',
        status: 'active',
        filePath: `data/sessions/1/${sdkSessionId}.jsonl`,
        lastMessageAt: null,
        projectId: 1,
        createdAt: now,
        updatedAt: now,
      };
      vi.spyOn(prisma.session, 'create').mockResolvedValue(created);

      const result = await service.create(1, sdkSessionId);

      expect(result.filePath).toBe(`data/sessions/1/${sdkSessionId}.jsonl`);
    });
  });

  describe('deleteBySdkSessionId', () => {
    const DATA_DIR = path.resolve(process.cwd(), 'data', 'sessions');

    it('应按 sdkSessionId 删除并清理 JSONL 文件', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);
      vi.spyOn(prisma.session, 'delete').mockResolvedValue(mockSessions[0] as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await service.deleteBySdkSessionId('sdk-uuid-abc');

      // 应使用约定路径而非 DB filePath 字段
      const expectedJsonlPath = path.join(DATA_DIR, '1', 'sdk-uuid-abc.jsonl');
      expect(fs.existsSync).toHaveBeenCalledWith(expectedJsonlPath);
      expect(fs.unlinkSync).toHaveBeenCalledWith(expectedJsonlPath);
      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { sdkSessionId: 'sdk-uuid-abc' } });
    });

    it('JSONL 文件不存在时应静默跳过', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);
      vi.spyOn(prisma.session, 'delete').mockResolvedValue(mockSessions[0] as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      await service.deleteBySdkSessionId('sdk-uuid-abc');

      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { sdkSessionId: 'sdk-uuid-abc' } });
    });

    it('JSONL 删除失败时应静默跳过（graceful）', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);
      vi.spyOn(prisma.session, 'delete').mockResolvedValue(mockSessions[0] as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('权限错误'); });

      // 不应抛出错误
      await expect(service.deleteBySdkSessionId('sdk-uuid-abc')).resolves.not.toThrow();
      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { sdkSessionId: 'sdk-uuid-abc' } });
    });

    it('会话不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.deleteBySdkSessionId('non-existent')).rejects.toThrow(NotFoundException);
      expect(prisma.session.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateTitle', () => {
    it('应更新会话标题', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(mockSessions[0]);
      vi.spyOn(prisma.session, 'update').mockResolvedValue({ ...mockSessions[0], title: '新标题' } as any);

      await service.updateTitle(1, '新标题');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { title: '新标题' },
      });
    });

    it('会话不存在时应抛出 NotFoundException', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);

      await expect(service.updateTitle(999, '标题')).rejects.toThrow(NotFoundException);
    });
  });
});
