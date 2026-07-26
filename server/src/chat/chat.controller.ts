import type { Response } from 'express';
import { BadRequestException, Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Logger } from 'nestjs-pino';
import { SseEventType } from '../agent/types/sse-events';
import type { SseEvent } from '../agent/types/sse-events';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import type { ChatAction } from './dto/chat-request.dto';
import { ChatRequestDto } from './dto/chat-request.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@SkipThrottle()
@Controller()
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly logger: Logger,
  ) {}

  @Post('chat')
  @ApiOperation({ summary: '统一聊天端点，根据 action 分发处理' })
  @SkipThrottle({ global: false, user: false })
  async chat(@Body() dto: ChatRequestDto, @Res() res: Response): Promise<void> {
    this.validateRequest(dto);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // SSE 事件推送函数
    const pushEvent = (event: SseEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      switch (dto.action) {
        case 'message':
          await this.chatService.sendAndStream({
            content: dto.content!,
            sdkSessionId: dto.sessionId,
            projectId: dto.projectId,
            onEvent: pushEvent,
          });
          break;

        case 'confirm':
          await this.chatService.confirmAndStream({
            sdkSessionId: dto.sessionId!,
            confirmOption: dto.confirmOption!,
            onEvent: pushEvent,
          });
          break;

        case 'cancel':
          await this.chatService.cancelResponse(dto.sessionId!);
          pushEvent({ type: SseEventType.StreamComplete, data: {} });
          break;
      }
    } catch (error) {
      const errMsg = (error as Error).message;
      this.logger.error(`Chat error: ${errMsg}`);
      pushEvent({ type: SseEventType.Error, data: { message: errMsg } });
    } finally {
      res.end();
    }
  }

  @Get('sessions/:sdkSessionId/messages')
  @ApiOperation({ summary: '获取会话历史消息' })
  async getMessages(@Param('sdkSessionId') sdkSessionId: string) {
    return this.chatService.getSessionMessages(sdkSessionId);
  }

  /**
   * 请求体验证
   */
  private validateRequest(dto: ChatRequestDto): void {
    const action: ChatAction = dto.action;

    if (action === 'message') {
      if (!dto.content || !dto.content.trim()) {
        throw new BadRequestException('action: message 需要 content');
      }
    } else if (action === 'confirm') {
      if (!dto.sessionId) {
        throw new BadRequestException('action: confirm 需要 sessionId');
      }
      if (!dto.confirmOption) {
        throw new BadRequestException('action: confirm 需要 confirmOption');
      }
    } else if (action === 'cancel') {
      if (!dto.sessionId) {
        throw new BadRequestException('action: cancel 需要 sessionId');
      }
    } else {
      throw new BadRequestException(`未知 action: ${action}`);
    }
  }
}
