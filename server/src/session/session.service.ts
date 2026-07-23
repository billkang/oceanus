import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 数据目录常量 */
  private readonly DATA_DIR = path.resolve(process.cwd(), 'data', 'sessions');

  /** 按约定计算 JSONL 文件路径 */
  private jsonlPath(projectId: number, sdkSessionId: string): string {
    return path.join(this.DATA_DIR, String(projectId), `${sdkSessionId}.jsonl`);
  }

  /** 项目下的会话列表（按最后消息时间倒序） */
  async listByProject(projectId: number) {
    return this.prisma.session.findMany({
      where: { projectId },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  /** 会话详情（含项目名） */
  async getById(id: number) {
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { project: true },
    });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }

  /** 根据 SDK 会话 ID 查找 */
  async getBySdkSessionId(sdkSessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { sdkSessionId },
      include: { project: true },
    });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }

  /** 创建新会话（使用 SDK 生成的 session ID） */
  async create(projectId: number, sdkSessionId: string) {
    const filePath = `data/sessions/${projectId}/${sdkSessionId}.jsonl`;

    return this.prisma.session.create({
      data: {
        projectId,
        sdkSessionId,
        title: '新会话',
        filePath,
      },
    });
  }

  /** 删除会话（按 sdkSessionId，级联清理 JSONL 文件） */
  async deleteBySdkSessionId(sdkSessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { sdkSessionId } });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // 按约定路径清理 JSONL，不依赖 DB 中 filePath 字段
    const jsonlPath = this.jsonlPath(session.projectId, sdkSessionId);
    try {
      if (fs.existsSync(jsonlPath)) {
        fs.unlinkSync(jsonlPath);
      }
    } catch {
      // 文件删除失败不影响数据库删除
    }

    await this.prisma.session.delete({ where: { sdkSessionId } });
  }

  /** （兼容旧接口）按自增 ID 删除会话 */
  async delete(id: number) {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }

    // 按约定路径清理 JSONL
    const jsonlPath = this.jsonlPath(session.projectId, session.sdkSessionId);
    try {
      if (fs.existsSync(jsonlPath)) {
        fs.unlinkSync(jsonlPath);
      }
    } catch {
      // 文件删除失败不影响数据库删除
    }

    await this.prisma.session.delete({ where: { id } });
  }

  /** 更新会话标题 */
  async updateTitle(id: number, title: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    await this.prisma.session.update({
      where: { id },
      data: { title },
    });
  }

}
