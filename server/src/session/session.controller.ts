import { Controller, Delete, Get, Param, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from '../project/project.service';
import { SessionService } from './session.service';

@ApiTags('Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly projectService: ProjectService,
  ) {}

  @Get('projects/:projectName/sessions')
  @ApiOperation({ summary: '会话列表（按项目 projectName，当前用户）' })
  async listByProject(@Param('projectName') projectName: string, @Req() req: Request) {
    const username = (req.user as { username: string }).username;
    await this.projectService.assertMember(projectName, username); // 非成员 404
    return this.sessionService.listByProject(projectName, username);
  }

  @Get('sessions/:sdkSessionId')
  @ApiOperation({ summary: '会话详情（仅所有者）' })
  async getBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string, @Req() req: Request) {
    const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
    if (session.username !== (req.user as { username: string }).username) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }

  @Delete('sessions/:sdkSessionId')
  @ApiOperation({ summary: '删除会话（仅所有者，含记录清理）' })
  async deleteBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string, @Req() req: Request) {
    const username = (req.user as { username: string }).username;
    const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
    if (session.username !== username) {
      throw new NotFoundException('会话不存在');
    }
    const partitionKey = `${session.project.projectName}/${session.username}`;
    await this.sessionService.deleteBySdkSessionId(sdkSessionId, partitionKey);
    return { success: true };
  }
}
