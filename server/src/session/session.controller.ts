import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SessionService } from './session.service';

@ApiTags('Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('projects/:projectId/sessions')
  @ApiOperation({ summary: '会话列表（按项目）' })
  async listByProject(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.sessionService.listByProject(projectId);
  }

  @Post('projects/:projectId/sessions')
  @ApiOperation({ summary: '创建会话（手动，一般由首条消息自动创建）' })
  async create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body('sdkSessionId') sdkSessionId: string,
  ) {
    return this.sessionService.create(projectId, sdkSessionId);
  }

  @Get('sessions/:sdkSessionId')
  @ApiOperation({ summary: '会话详情' })
  async getBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string) {
    return this.sessionService.getBySdkSessionId(sdkSessionId);
  }

  @Delete('sessions/:sdkSessionId')
  @ApiOperation({ summary: '删除会话（含 JSONL 清理）' })
  async deleteBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string) {
    await this.sessionService.deleteBySdkSessionId(sdkSessionId);
    return { success: true };
  }
}
