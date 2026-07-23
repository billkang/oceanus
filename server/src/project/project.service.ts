import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

const projectInclude = { _count: { select: { sessions: true } } } as const;

/** Prisma 返回的项目记录转前端格式（_count → sessionCount） */
function toResponse(project: Record<string, unknown>) {
  const { _count, ...rest } = project as {
    _count: { sessions: number };
  } & Record<string, unknown>;
  return { ...rest, sessionCount: _count.sessions };
}

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  /** 项目列表（按更新时间倒序） */
  async list() {
    const projects = await this.prisma.project.findMany({
      where: { active: true },
      orderBy: { updatedAt: 'desc' },
      include: projectInclude,
    });
    return projects.map(toResponse);
  }

  /** 项目详情 */
  async getById(id: number) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: projectInclude,
    });
    if (!project) {
      throw new NotFoundException('项目不存在');
    }
    return toResponse(project);
  }

  /** 创建项目 */
  async create(dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        description: dto.description || null,
      },
      include: projectInclude,
    });
    return toResponse(project);
  }

  /** 编辑项目 */
  async update(id: number, dto: UpdateProjectDto) {
    await this.ensureExists(id);
    const project = await this.prisma.project.update({
      where: { id },
      data: dto,
      include: projectInclude,
    });
    return toResponse(project);
  }

  /** 删除项目（级联删除会话 + 资产） */
  async delete(id: number) {
    await this.ensureExists(id);
    await this.prisma.project.delete({ where: { id } });
  }

  private async ensureExists(id: number) {
    const exists = await this.prisma.project.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('项目不存在');
    }
  }
}
