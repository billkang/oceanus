import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  /** 项目列表：仅当前用户是成员的项目（带角色） */
  async list(username: string) {
    const projects = await this.prisma.project.findMany({
      where: { active: true, members: { some: { username } } },
      orderBy: { updatedAt: 'desc' },
      include: { ...projectInclude, members: { where: { username }, select: { role: true } } },
    });
    return projects.map((p) => ({
      ...toResponse(p),
      role: p.members[0]?.role ?? 'member',
    }));
  }

  /** 按 projectName 查项目（含会话数量），不存在抛 404 */
  private async getByProjectNameOrThrow(projectName: string) {
    const project = await this.prisma.project.findUnique({
      where: { projectName },
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

  /** 创建项目：事务内自动写 owner ProjectMember */
  async create(dto: CreateProjectDto, username: string) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { displayName: dto.displayName, projectName: dto.projectName, description: dto.description || null },
        include: projectInclude,
      });
      await tx.projectMember.create({
        data: { projectId: project.id, username, role: 'owner' },
      });
      return toResponse(project);
    });
  }

  /** 编辑项目（owner-only，projectName 不可改） */
  async update(projectName: string, username: string, dto: UpdateProjectDto) {
    await this.assertOwner(projectName, username);
    const project = await this.prisma.project.update({
      where: { projectName },
      // 部分更新：未提供的字段传 undefined（Prisma 忽略），避免把原值覆盖为 null
      data: { displayName: dto.displayName, description: dto.description ?? undefined },
      include: projectInclude,
    });
    return toResponse(project);
  }

  /** 删除项目（owner-only）：SessionEntry 清理 + 项目删除原子事务 */
  async delete(projectName: string, username: string) {
    await this.assertOwner(projectName, username);
    await this.prisma.$transaction([
      this.prisma.sessionEntry.deleteMany({
        where: { partitionKey: { startsWith: `${projectName}/` } },
      }),
      this.prisma.project.delete({ where: { projectName } }),
    ]);
  }

  private async assertOwner(projectName: string, username: string): Promise<void> {
    const project = await this.getByProjectNameOrThrow(projectName);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_username: { projectId: project.id, username } },
    });
    if (!member || member.role !== 'owner') throw new NotFoundException('项目不存在');
  }
}
