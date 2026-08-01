import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { KeyPoolEntry, KeyPoolStats } from './key-pool.interface';

@Injectable()
export class KeyPoolService implements OnModuleInit {
  private keys: KeyPoolEntry[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.loadKeysFromEnv();
    this.logger.log(`Key pool initialized with ${this.keys.length} keys`);
  }

  private loadKeysFromEnv(): void {
    for (let i = 1; ; i++) {
      const key = this.configService.get<string>(`LLM_API_KEY_${i}`);
      if (!key) break;
      this.keys.push({ key, usageCount: 0, failureCount: 0, lastFailureAt: null });
    }
  }

  async select(): Promise<string> {
    if (this.keys.length === 0) {
      throw new Error('AI 服务不可用，请配置 LLM_API_KEY_N');
    }
    return this.selectLocal();
  }

  private selectLocal(): string {
    const sorted = [...this.keys].sort((a, b) => a.usageCount - b.usageCount);
    const selected = sorted[0];
    selected.usageCount++;
    return selected.key;
  }

  async markFailure(key: string): Promise<void> {
    const entry = this.keys.find((k) => k.key === key);
    if (entry) {
      entry.failureCount++;
      entry.lastFailureAt = Date.now();
    }
  }

  getPoolStats(): KeyPoolStats {
    return {
      totalKeys: this.keys.length,
      healthyKeys: this.keys.filter((k) => k.failureCount < 3).length,
      totalUsage: this.keys.reduce((s, k) => s + k.usageCount, 0),
      totalFailures: this.keys.reduce((s, k) => s + k.failureCount, 0),
    };
  }

  getKeyCount(): number {
    return this.keys.length;
  }
}
