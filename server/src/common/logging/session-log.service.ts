import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from 'nestjs-pino';

/**
 * 会话级别日志服务
 *
 * 写入 logs/{projectName}/{sessionId}.log 文件，按项目名+会话颗粒度分文件。
 * 使用 fs.appendFileSync 直接同步写入，确保日志立即落盘。
 * 会话结束后调用 closeSession() 释放资源。
 */
@Injectable()
export class SessionLogService implements OnModuleDestroy {
  /** 已打开的日志文件路径集合（用于跟踪） */
  private readonly openFiles = new Set<string>();

  private logDir = path.resolve(process.cwd(), 'logs');

  /** 首次日志写入失败标记（避免重复告警） */
  private warned = false;

  constructor(
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /** 设置日志根目录（用于测试） */
  setLogDir(dir: string): void {
    this.logDir = dir;
  }

  /**
   * 写入一条日志到会话文件
   *
   * @param projectName 项目名称
   * @param sessionId 会话 UUID
   * @param msg 日志消息
   * @param data 附加数据（可选）
   */
  log(projectName: string, sessionId: string, msg: string, data?: Record<string, unknown>): void {
    try {
      const dir = path.join(this.logDir, projectName);
      fs.mkdirSync(dir, { recursive: true });

      const filePath = path.join(dir, `${sessionId}.log`);
      this.openFiles.add(filePath);

      const timestamp = new Date().toISOString();
      const line = data
        ? JSON.stringify({ time: timestamp, msg, ...data }) + '\n'
        : JSON.stringify({ time: timestamp, msg }) + '\n';

      fs.appendFileSync(filePath, line, 'utf-8');

      // 首次写入成功后输出提示
      if (!this.warned) {
        this.logger.log(`SessionLogService: 日志写入成功 -> ${filePath}`);
        this.warned = true;
      }
    } catch (err) {
      // 静默降级：日志写入失败不应影响主流程
      // 但通过应用级 logger 输出错误以便排查
      this.logger.warn(
        `SessionLogService: 日志写入失败 (logDir=${this.logDir}, cwd=${process.cwd()}) — ${(err as Error).message}`,
      );
    }
  }

  /**
   * 关闭会话（清理跟踪记录）
   */
  async closeSession(projectName: string, sessionId: string): Promise<void> {
    const filePath = path.join(this.logDir, projectName, `${sessionId}.log`);
    this.openFiles.delete(filePath);
  }

  /** 模块销毁时清理 */
  async onModuleDestroy(): Promise<void> {
    this.openFiles.clear();
  }
}
