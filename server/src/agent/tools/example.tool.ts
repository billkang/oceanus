import { Injectable } from '@nestjs/common';
import pino from 'pino';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

@Injectable()
export class ExampleTool implements ToolDefinition {
  private readonly logger = pino({ name: 'ExampleTool' });

  name = 'get_current_time';
  description = '获取当前日期和时间';
  input_schema = {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: '时区（可选，默认 UTC）',
        enum: ['UTC', 'Asia/Shanghai', 'America/New_York'],
      },
    },
  };

  async execute(input: Record<string, unknown>): Promise<unknown> {
    try {
      this.logger.debug(`Tool execute: get_current_time with input: ${JSON.stringify(input)}`);
      const now = new Date();
      return {
        success: true,
        data: {
          iso: now.toISOString(),
          timestamp: now.getTime(),
        },
      };
    } catch (error) {
      this.logger.error(`Tool execution failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
