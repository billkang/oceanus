import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** POST /api/v1/chat 支持的操作类型 */
export type ChatAction = 'message' | 'confirm' | 'cancel';

/** 基础请求体字段 */
export class ChatRequestDto {
  @IsString()
  @IsIn(['message', 'confirm', 'cancel'])
  action!: ChatAction;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  content?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsOptional()
  projectId?: string | number;

  @IsString()
  @IsOptional()
  confirmOption?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    example: 'deepseek',
    description: '逻辑模型名（来自 GET /models）；省略用默认 provider',
    required: false,
  })
  model?: string;
}
