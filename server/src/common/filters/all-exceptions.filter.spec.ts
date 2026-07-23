import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

  beforeEach(() => {
    filter = new AllExceptionsFilter(mockLogger);
  });

  function mockHost(status: number, json: Record<string, unknown>) {
    return {
      switchToHttp: () => ({
        getResponse: () => ({
          status: vi.fn().mockReturnThis(),
          json: vi.fn().mockImplementation((data) => { Object.assign(json, data); }),
        } as unknown as ReturnType<any>),
      }),
    } as unknown as ArgumentsHost;
  }

  it('HttpException 应返回对应状态码', () => {
    const response: Record<string, unknown> = {};
    const host = mockHost(404, response);
    const exception = new HttpException('资源不存在', HttpStatus.NOT_FOUND);

    filter.catch(exception, host);

    expect(response).toMatchObject({
      success: false,
      statusCode: 404,
      message: '资源不存在',
    });
  });

  it('未捕获异常应返回 500', () => {
    const response: Record<string, unknown> = {};
    const host = mockHost(500, response);

    filter.catch(new Error('Unknown'), host);

    expect(response).toMatchObject({
      success: false,
      statusCode: 500,
    });
  });

  it('响应应包含 timestamp', () => {
    const response: Record<string, unknown> = {};
    const host = mockHost(400, response);
    const exception = new HttpException('参数错误', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(response).toHaveProperty('timestamp');
    expect(typeof response.timestamp).toBe('string');
  });
});
