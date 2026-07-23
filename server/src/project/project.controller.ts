import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from './project.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @ApiOperation({ summary: '项目列表' })
  async list() {
    return this.projectService.list();
  }

  @Post()
  @ApiOperation({ summary: '创建项目' })
  async create(@Body() dto: CreateProjectDto) {
    return this.projectService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '项目详情' })
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '编辑项目' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除项目' })
  async delete(@Param('id', ParseIntPipe) id: number) {
    return this.projectService.delete(id);
  }
}
