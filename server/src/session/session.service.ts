import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 项目（projectName）下当前用户的会话列表 */
  async listByProject(projectName: string, username: string) {
    return this.prisma.session.findMany({
      where: { project: { projectName }, username },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { project: { select: { projectName: true, displayName: true } } },
    });
  }

  /** 会话详情（含项目信息） */
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

  /** 创建会话（首条消息懒创建，记录归属用户 username） */
  async create(projectId: number, sdkSessionId: string, username: string) {
    return this.prisma.session.create({
      data: { projectId, sdkSessionId, title: '新会话', username },
    });
  }

  /** 更新最后消息时间（afterStreamComplete 管线首步） */
  async touch(sdkSessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { sdkSessionId },
      data: { lastMessageAt: new Date() },
    });
  }

  /** 删除会话：SessionEntry 清理 + Session 删除原子事务 */
  async deleteBySdkSessionId(sdkSessionId: string, partitionKey: string) {
    const session = await this.getBySdkSessionId(sdkSessionId);
    await this.prisma.$transaction([
      this.prisma.sessionEntry.deleteMany({
        where: { partitionKey, sessionId: sdkSessionId },
      }),
      this.prisma.session.delete({ where: { sdkSessionId } }),
    ]);
    return session;
  }

  /** 更新会话标题 */
  async updateTitle(id: number, title: string): Promise<void> {
    await this.prisma.session.update({
      where: { id },
      data: { title },
    });
  }
}
