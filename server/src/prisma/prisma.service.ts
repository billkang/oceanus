import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { raw } from '@prisma/client/runtime/library';
import type { PrismaPromise } from '@prisma/client/runtime/library';
import { Logger } from 'nestjs-pino';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly poolSize: number | null;

  constructor(private readonly logger: Logger) {
    const poolSizeEnv = process.env.PRISMA_CONNECTION_LIMIT;
    const poolSize = poolSizeEnv ? parseInt(poolSizeEnv, 10) : null;

    // 如果配置了 PRISMA_CONNECTION_LIMIT，注入到 DATABASE_URL
    const opts: Record<string, unknown> = {};
    if (poolSize && !Number.isNaN(poolSize)) {
      const baseUrl = process.env.DATABASE_URL || 'postgresql://root:123456@localhost:5432/oceanus';
      const sep = baseUrl.includes('?') ? '&' : '?';
      opts.datasourceUrl = `${baseUrl}${sep}connection_limit=${poolSize}`;
    }
    super(opts);

    this.poolSize = poolSize && !Number.isNaN(poolSize) ? poolSize : null;
  }

  /**
   * Execute a raw SQL query string.
   * Provided for @nestjs/terminus PrismaHealthIndicator compatibility.
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): PrismaPromise<T> {
    return this.$queryRaw(raw(query), ...values) as PrismaPromise<T>;
  }

  async onModuleInit() {
    await this.$connect();
    const label = this.poolSize ? `pool=${this.poolSize}` : 'auto';
    this.logger.log(`Database connected (connection pool: ${label})`);

    // Cluster 模式下校验总连接数
    const clusterEnabled = process.env.CLUSTER_ENABLED === 'true';
    if (clusterEnabled && this.poolSize) {
      const workers = process.env.CLUSTER_WORKERS ? parseInt(process.env.CLUSTER_WORKERS, 10) : 4;
      const total = workers * this.poolSize;
      this.logger.warn(
        `Cluster 模式: ${workers} workers × pool=${this.poolSize} = 预计 ${total} 连接; ` +
          `请确保 PostgreSQL max_connections >= ${total}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
