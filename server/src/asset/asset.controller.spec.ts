import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

describe('AssetController', () => {
  let controller: AssetController;
  let assetService: AssetService;

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
  ];

  const mockAssetService = {
    listBySession: vi.fn(),
    getById: vi.fn(),
    getContent: vi.fn(),
    download: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssetController],
      providers: [
        { provide: AssetService, useValue: mockAssetService },
        { provide: JwtService, useValue: { verify: vi.fn() } },
      ],
    }).compile();

    controller = module.get<AssetController>(AssetController);
    assetService = module.get<AssetService>(AssetService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /sessions/:sessionId/assets', () => {
    it('应返回资产列表', async () => {
      mockAssetService.listBySession.mockResolvedValue(mockAssets);

      const result = await controller.listBySession(10);

      expect(result).toEqual(mockAssets);
      expect(assetService.listBySession).toHaveBeenCalledWith(10);
    });
  });

  describe('GET /assets/:id', () => {
    it('应返回资产详情', async () => {
      mockAssetService.getById.mockResolvedValue(mockAssets[0]);

      const result = await controller.getById(1);

      expect(result).toEqual(mockAssets[0]);
      expect(assetService.getById).toHaveBeenCalledWith(1);
    });
  });

  describe('GET /assets/:id/download', () => {
    it('应返回文件响应', async () => {
      const downloadInfo = {
        title: '用户登录 PRD',
        content: '# 用户登录',
        filename: '用户登录 PRD.md',
      };
      mockAssetService.download.mockResolvedValue(downloadInfo);

      const mockRes = { set: vi.fn() };
      const result = await controller.download(1, mockRes as any);

      expect(result).toEqual({
        content: '# 用户登录',
        filename: '用户登录 PRD.md',
      });
      expect(mockRes.set).toHaveBeenCalledWith({
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="%E7%94%A8%E6%88%B7%E7%99%BB%E5%BD%95%20PRD.md"',
      });
      expect(assetService.download).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /assets/:id/copy', () => {
    it('应返回资产内容', async () => {
      mockAssetService.getContent.mockResolvedValue('# 用户登录');

      const result = await controller.copy(1);

      expect(result).toEqual({ content: '# 用户登录' });
      expect(assetService.getContent).toHaveBeenCalledWith(1);
    });
  });
});
