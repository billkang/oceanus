import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { KeyPoolEntry, KeyPoolStats } from './key-pool.interface';

/** 全局池默认前缀（provider 声明 keyPool: true 时使用） */
export const DEFAULT_KEY_POOL_PREFIX = 'LLM_API_KEY_';

@Injectable()
export class KeyPoolService implements OnModuleInit {
  /** 池名（env 前缀）→ 该池的 Key 列表；支持多个命名池（如 KIMI_API_KEY_） */
  private readonly pools = new Map<string, KeyPoolEntry[]>();

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.pools.set(DEFAULT_KEY_POOL_PREFIX, this.loadPool(DEFAULT_KEY_POOL_PREFIX));
    this.logger.log(`Key pool initialized with ${this.getKeyCount()} keys`);
  }

  /** 从 `${prefix}1..N` 环境变量读取一个池 */
  private loadPool(envPrefix: string): KeyPoolEntry[] {
    const entries: KeyPoolEntry[] = [];
    for (let i = 1; ; i++) {
      const key = this.configService.get<string>(`${envPrefix}${i}`);
      if (!key) break;
      entries.push({ key, usageCount: 0, failureCount: 0, lastFailureAt: null });
    }
    return entries;
  }

  /** 惰性加载/获取指定前缀的池 */
  private getPool(envPrefix: string): KeyPoolEntry[] {
    if (!this.pools.has(envPrefix)) {
      this.pools.set(envPrefix, this.loadPool(envPrefix));
    }
    return this.pools.get(envPrefix)!;
  }

  /**
   * 从池中选择 Key（Least-Used 轮换）
   * @param envPrefix 池前缀，缺省用全局池 LLM_API_KEY_
   */
  async select(envPrefix = DEFAULT_KEY_POOL_PREFIX): Promise<string> {
    const pool = this.getPool(envPrefix);
    if (pool.length === 0) {
      const label = envPrefix.replace(/_$/, '');
      throw new Error(`AI 服务不可用，请配置 ${label}_N`);
    }
    return this.selectLocal(pool);
  }

  private selectLocal(pool: KeyPoolEntry[]): string {
    const sorted = [...pool].sort((a, b) => a.usageCount - b.usageCount);
    const selected = sorted[0];
    selected.usageCount++;
    return selected.key;
  }

  /** 标记 Key 故障（跨池查找，Key 值全局唯一） */
  async markFailure(key: string): Promise<void> {
    for (const pool of this.pools.values()) {
      const entry = pool.find((k) => k.key === key);
      if (entry) {
        entry.failureCount++;
        entry.lastFailureAt = Date.now();
        return;
      }
    }
  }

  /** 指定池的统计（缺省全局池） */
  getPoolStats(envPrefix = DEFAULT_KEY_POOL_PREFIX): KeyPoolStats {
    const pool = this.getPool(envPrefix);
    return {
      totalKeys: pool.length,
      healthyKeys: pool.filter((k) => k.failureCount < 3).length,
      totalUsage: pool.reduce((s, k) => s + k.usageCount, 0),
      totalFailures: pool.reduce((s, k) => s + k.failureCount, 0),
    };
  }

  /** 指定池的 Key 数量（缺省全局池） */
  getKeyCount(envPrefix = DEFAULT_KEY_POOL_PREFIX): number {
    return this.getPool(envPrefix).length;
  }
}
