import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { SkillsProvider } from '../skills/skills-provider.interface';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

const projectInclude = { _count: { select: { sessions: true } } } as const;

/** Prisma 返回的项目记录转前端格式（_count → sessionCount），保留项目全字段 */
function toResponse<T extends { _count: { sessions: number } }>(project: T) {
  const { _count, ...rest } = project;
  return { ...rest, sessionCount: _count.sessions };
}

@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly skills: SkillsProvider,
    private readonly logger: Logger,
  ) {}

  /** 项目列表：仅当前用户是成员的项目（带角色，排除软删） */
  async list(username: string) {
    const projects = await this.prisma.project.findMany({
      where: { active: true, deletedAt: null, members: { some: { username } } },
      orderBy: { updatedAt: 'desc' },
      include: { ...projectInclude, members: { where: { username }, select: { role: true } } },
    });
    return projects.map((p) => ({
      ...toResponse(p),
      role: p.members[0]?.role ?? 'member',
    }));
  }

  /** 按 projectName 查项目（含会话数量，排除软删），不存在抛 404 */
  private async getByProjectNameOrThrow(projectName: string) {
    const project = await this.prisma.project.findFirst({
      where: { projectName, deletedAt: null },
      include: projectInclude,
    });
    if (!project) throw new NotFoundException('项目不存在');
    return project;
  }

  /** 成员校验：非成员统一 404（供 Session/Chat/Asset 复用） */
  async assertMember(projectName: string, username: string): Promise<void> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_username: { projectId: (await this.getByProjectNameOrThrow(projectName)).id, username } },
    });
    if (!member) throw new NotFoundException('项目不存在');
  }

  /** 项目详情（仅成员） */
  async getById(projectName: string, username: string) {
    await this.assertMember(projectName, username);
    return toResponse(await this.getByProjectNameOrThrow(projectName));
  }

  /**
   * 创建项目：唯一性预校验 → FS 先行（残留处理 + 骨架）→ DB 事务 → skills best-effort。
   * FS 失败直接中止（DB 无副作用）；DB 失败 best-effort 清刚建骨架；skills 失败不阻断（惰性刷新补装）。
   */
  async create(dto: CreateProjectDto, username: string) {
    const projectName = dto.projectName;
    // 1. 唯一性预校验（活跃记录，软删可复用同名）
    const existing = await this.prisma.project.findFirst({
      where: { projectName, deletedAt: null },
      select: { id: true },
    });
    if (existing) throw new ConflictException('该英文标识已被使用');
    // 2. FS 先行：残留目录进回收站 + 建骨架（失败则中止，DB 无副作用）
    await this.workspace.ensureFreshProjectDir(projectName);
    await this.workspace.createSkeleton(projectName);
    // 3. DB 事务
    const project = await this.prisma
      .$transaction(async (tx) => {
        const p = await tx.project.create({
          data: { displayName: dto.displayName, projectName, description: dto.description || null },
          include: projectInclude,
        });
        await tx.projectMember.create({ data: { projectId: p.id, username, role: 'owner' } });
        return p;
      })
      .catch(async (err: Error) => {
        // DB 失败罕见（唯一性已预校验）：best-effort 清刚建骨架，避免孤儿目录
        await this.workspace.moveToTrash(this.workspace.paths.projectRoot(projectName)).catch(() => undefined);
        throw err;
      });
    // 4. skills 安装（best-effort 不阻断，后续惰性刷新补装）
    this.skills.install(this.workspace.paths.projectRoot(projectName)).catch((e: Error) => {
      this.logger.error(`skills 安装失败（后续惰性刷新补装）: ${e.message}`);
    });
    return toResponse(project);
  }

  /** 编辑项目（owner-only，projectName 不可改） */
  async update(projectName: string, username: string, dto: UpdateProjectDto) {
    const owner = await this.assertOwner(projectName, username);
    const project = await this.prisma.project.update({
      where: { id: owner.id },
      // 部分更新：未提供的字段传 undefined（Prisma 忽略），避免把原值覆盖为 null
      data: { displayName: dto.displayName, description: dto.description ?? undefined },
      include: projectInclude,
    });
    return toResponse(project);
  }

  /**
   * 删除项目（owner-only）：DB 软删级联（session / projectMember / sessionEntry / asset / project）
   * 原子事务，随后项目目录移入回收站（失败仅记日志，不阻断 DB）。
   *
   * 级联口径说明：
   * - sessionEntry 无 FK（规避 SDK append 时序竞态），先抓取本项目全部会话 id，
   *   再按 `sessionId in [...]` 精确级联（partitionKey 前缀仅作命名空间防御），
   *   避免按前缀匹配误伤同名（软删后复用）项目的活跃记录；
   * - asset 创建时不落 projectId（由会话推导），故按 `session.projectId` 关系级联，
   *   确保删除项目后其 PRD 资产一并软删、不可再读。
   */
  async delete(projectName: string, username: string) {
    const project = await this.assertOwner(projectName, username);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const sessions = await tx.session.findMany({
        where: { projectId: project.id, deletedAt: null },
        select: { sdkSessionId: true },
      });
      await tx.session.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: now } });
      await tx.projectMember.updateMany({
        where: { projectId: project.id, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.sessionEntry.updateMany({
        where: {
          sessionId: { in: sessions.map((s) => s.sdkSessionId) },
          partitionKey: { startsWith: `${projectName}/` },
        },
        data: { deletedAt: now },
      });
      await tx.asset.updateMany({
        where: { session: { projectId: project.id }, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.project.update({ where: { id: project.id }, data: { deletedAt: now } });
    });
    await this.workspace
      .moveToTrash(this.workspace.paths.projectRoot(projectName))
      .catch((e: Error) => this.logger.error(`项目目录移入回收站失败: ${e.message}`));
  }

  /** 校验 owner 并返回项目（供 update/delete 用 id 定位） */
  private async assertOwner(projectName: string, username: string) {
    const project = await this.getByProjectNameOrThrow(projectName);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_username: { projectId: project.id, username } },
    });
    if (!member || member.role !== 'owner') throw new NotFoundException('项目不存在');
    return project;
  }
}
