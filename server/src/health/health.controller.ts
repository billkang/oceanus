import { Controller, Get } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import cluster from 'node:cluster';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      async (): Promise<HealthIndicatorResult> => ({
        cluster: {
          status: 'up',
          enabled: process.env.CLUSTER_ENABLED === 'true',
          isWorker: cluster.isWorker,
          workerId: cluster.isWorker ? (cluster.worker?.id ?? null) : null,
          activeWorkers: cluster.isPrimary ? (cluster.workers ? Object.keys(cluster.workers).length : 0) : 0,
        },
      }),
    ]);
  }
}
