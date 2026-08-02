import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  /** 创建资产（PRD 自动提取用，调用方已校验会话归属） */
  async create(data: { sessionId: number; projectId?: number; type: string; title: string; content: string }) {
    return this.prisma.asset.create({
      data: {
        sessionId: data.sessionId,
        projectId: data.projectId ?? null,
        type: data.type,
        title: data.title,
        content: data.content,
      },
    });
  }

  /** 会话下的资产列表（按创建时间倒序，校验会话归属） */
  async listBySession(sessionId: number, username: string) {
    await this.assertSessionOwned(sessionId, username);
    return this.prisma.asset.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 资产详情（校验资产归属） */
  async getById(id: number, username: string) {
    const asset = await this.assertOwned(id, username);
    const { session: _session, ...rest } = asset;
    return rest;
  }

  /** 获取资产内容（供复制，校验资产归属） */
  async getContent(id: number, username: string) {
    const asset = await this.assertOwned(id, username);
    return asset.content;
  }

  /** 下载资产：返回下载信息（不含流式处理，由 controller 处理 Content-Disposition，校验资产归属） */
  async download(id: number, username: string) {
    const asset = await this.assertOwned(id, username);
    return {
      title: asset.title,
      content: asset.content,
      filename: `${asset.title}.md`,
    };
  }

  /** 校验会话归属（非所有者统一 404，不泄露存在性） */
  private async assertSessionOwned(sessionId: number, username: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { username: true },
    });
    if (!session || session.username !== username) {
      throw new NotFoundException('资产不存在');
    }
  }

  /** 校验资产归属（asset → session → username），返回资产含 session 投影 */
  private async assertOwned(assetId: number, username: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { session: { select: { username: true } } },
    });
    if (!asset || asset.session.username !== username) {
      throw new NotFoundException('资产不存在');
    }
    return asset;
  }
}
