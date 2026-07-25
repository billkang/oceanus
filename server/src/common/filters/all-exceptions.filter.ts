import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Logger } from 'nestjs-pino';
import type { Response } from 'express';

/**
 * 全局异常过滤器
 * 捕获所有未处理的异常，返回统一的 JSON 响应格式
 */
@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = ((res as Record<string, unknown>).message as string) || message;
        if (Array.isArray(message)) {
          message = (message as string[])[0] || '请求参数错误';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // 记录 5xx 错误日志并上报 Sentry/GlitchTip
    if (status >= 500) {
      this.logger.error(`[${status}] ${message}`, exception instanceof Error ? exception.stack : undefined);
      Sentry.captureException(exception);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
