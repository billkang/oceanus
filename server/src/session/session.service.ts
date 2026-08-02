import { Injectable, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly logger: Logger,
  ) {}

  /** 项目（projectName）下当前用户的会话列表（不含已软删） */
  async listByProject(projectName: string, username: string) {
    return this.prisma.session.findMany({
      where: { project: { projectName }, username, deletedAt: null },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { project: { select: { projectName: true, displayName: true } } },
    });
  }

  /** 会话详情（含项目信息，已软删视为不存在） */
  async getBySdkSessionId(sdkSessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { sdkSessionId },
      include: { project: true },
    });
    if (!session || session.deletedAt !== null) {
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

  /** 软删会话：SessionEntry / Asset 级联标记 deletedAt + Session 软删，会话目录移入回收站 */
  async deleteBySdkSessionId(sdkSessionId: string, partitionKey: string) {
    const session = await this.getBySdkSessionId(sdkSessionId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sessionEntry.updateMany({
        where: { partitionKey, sessionId: sdkSessionId, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.asset.updateMany({
        where: { sessionId: session.id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.session.update({ where: { sdkSessionId }, data: { deletedAt: now } }),
    ]);
    // 会话目录进回收站（失败仅记日志，不阻断 DB 删除）
    await this.workspace
      .moveToTrash(this.workspace.paths.sessionDir(session.project.projectName, session.username, sdkSessionId))
      .catch((e: Error) => this.logger.error(`会话目录移入回收站失败: ${e.message}`));
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
