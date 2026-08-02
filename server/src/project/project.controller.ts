import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from './project.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @ApiOperation({ summary: '项目列表（当前用户成员）' })
  async list(@Req() req: Request) {
    return this.projectService.list((req.user as { username: string }).username);
  }

  @Post()
  @ApiOperation({ summary: '创建项目（自动 owner）' })
  async create(@Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projectService.create(dto, (req.user as { username: string }).username);
  }

  @Get(':projectName')
  @ApiOperation({ summary: '项目详情（仅成员）' })
  async getById(@Param('projectName') projectName: string, @Req() req: Request) {
    return this.projectService.getById(projectName, (req.user as { username: string }).username);
  }

  @Patch(':projectName')
  @ApiOperation({ summary: '编辑项目（owner-only）' })
  async update(@Param('projectName') projectName: string, @Body() dto: UpdateProjectDto, @Req() req: Request) {
    return this.projectService.update(projectName, (req.user as { username: string }).username, dto);
  }

  @Delete(':projectName')
  @ApiOperation({ summary: '删除项目（owner-only）' })
  async delete(@Param('projectName') projectName: string, @Req() req: Request) {
    await this.projectService.delete(projectName, (req.user as { username: string }).username);
    return { success: true };
  }
}
