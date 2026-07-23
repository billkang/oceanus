import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssetService } from './asset.service';

@ApiTags('Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  @Get('sessions/:sessionId/assets')
  @ApiOperation({ summary: '资产列表（按会话）' })
  async listBySession(@Param('sessionId', ParseIntPipe) sessionId: number) {
    return this.assetService.listBySession(sessionId);
  }

  @Get('assets/:id')
  @ApiOperation({ summary: '资产详情' })
  async getById(@Param('id', ParseIntPipe) id: number) {
    return this.assetService.getById(id);
  }

  @Get('assets/:id/download')
  @ApiOperation({ summary: '下载资产 .md 文件' })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.assetService.download(id);
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
    });
    return { content: result.content, filename: result.filename };
  }

  @Post('assets/:id/copy')
  @ApiOperation({ summary: '复制资产内容（返回纯文本）' })
  async copy(@Param('id', ParseIntPipe) id: number) {
    const content = await this.assetService.getContent(id);
    return { content };
  }
}
