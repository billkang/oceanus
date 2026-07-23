import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetService {
  constructor(private readonly prisma: PrismaService) {}

  /** 创建资产（PRD 自动提取用） */
  async create(data: {
    sessionId: number;
    projectId?: number;
    type: string;
    title: string;
    content: string;
  }) {
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

  /** 会话下的资产列表（按创建时间倒序） */
  async listBySession(sessionId: number) {
    return this.prisma.asset.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 资产详情 */
  async getById(id: number) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('资产不存在');
    }
    return asset;
  }

  /** 获取资产内容（供复制） */
  async getContent(id: number) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('资产不存在');
    }
    return asset.content;
  }

  /** 下载资产：返回下载信息（不含流式处理，由 controller 处理 Content-Disposition） */
  async download(id: number) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('资产不存在');
    }
    return {
      title: asset.title,
      content: asset.content,
      filename: `${asset.title}.md`,
    };
  }
}
