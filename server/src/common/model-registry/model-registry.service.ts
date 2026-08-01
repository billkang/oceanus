import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Logger } from 'nestjs-pino';
import { parse } from 'yaml';
import { KeyPoolService } from '../key-pool/key-pool.service';
import { ModelInfo, ModelRegistryConfig, ProviderConfig, ResolvedProvider } from './model-registry.types';

/**
 * 模型注册表服务
 *
 * 从 server/config/models.yaml 加载多 provider 配置（displayName/baseUrl/modelId/
 * smallFastModel/Key 来源），提供 provider 解析、可用性判定与模型列表。
 * Key 来源：keyPool: true → KeyPoolService 轮换（池前缀 = apiKeyEnv + '_'，每模型独立池）；
 *           池空回退 apiKeyEnv 单 Key。切模型即切池。
 */
@Injectable()
export class ModelRegistryService implements OnModuleInit {
  private config: ModelRegistryConfig | null = null;
  /** provider 名 → 不可用原因（可用时不在 Map 中） */
  private readonly unavailable = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly keyPool: KeyPoolService,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.load();
  }

  /** 加载注册表。filePath 缺省用 server/config/models.yaml */
  load(filePath?: string): void {
    const resolvedPath = filePath ?? path.resolve(process.cwd(), 'config', 'models.yaml');
    try {
      const raw = readFileSync(resolvedPath, 'utf8');
      this.config = this.validate(parse(raw) as ModelRegistryConfig);
      this.evaluateAvailability();
      this.logger.log(`模型注册表加载成功，可用 provider: ${this.listModels().length} 个`);
    } catch (err) {
      this.config = null;
      this.unavailable.clear();
      this.logger.warn(`模型注册表加载失败（${(err as Error).message}），AI 功能不可用`);
    }
  }

  private validate(parsed: ModelRegistryConfig): ModelRegistryConfig {
    if (!parsed?.models || Object.keys(parsed.models).length === 0) {
      throw new Error('models 列表为空');
    }
    const names = Object.keys(parsed.models);
    for (const name of names) {
      const p = parsed.models[name];
      if (!p?.displayName || !p.baseUrl || !p.modelId || !p.smallFastModel) {
        throw new Error(`provider ${name} 缺少必填字段（displayName/baseUrl/modelId/smallFastModel）`);
      }
      if (!p.apiKeyEnv) {
        throw new Error(`provider ${name} 缺少 apiKeyEnv（单 Key 与 keyPool 池前缀的来源）`);
      }
    }
    let defaultName = parsed.default;
    if (!defaultName) {
      defaultName = names[0];
      this.logger.warn(`models.yaml 未声明 default，回退使用第一个 provider: ${defaultName}`);
    }
    if (!names.includes(defaultName)) {
      throw new Error(`default provider ${defaultName} 不在 models 列表中`);
    }
    return { default: defaultName, models: parsed.models };
  }

  private evaluateAvailability(): void {
    if (!this.config) return;
    this.unavailable.clear();
    for (const [name, provider] of Object.entries(this.config.models)) {
      if (provider.enabled === false) {
        this.unavailable.set(name, '模型已禁用（enabled: false）');
        continue;
      }
      const reason = this.keyUnavailableReason(provider);
      if (reason) this.unavailable.set(name, reason);
    }
  }

  /** keyPool: true → 池前缀 = apiKeyEnv + '_'（每模型独立池，如 DEEPSEEK_API_KEY → DEEPSEEK_API_KEY_N） */
  private poolPrefix(provider: ProviderConfig): string {
    return `${provider.apiKeyEnv}_`;
  }

  private keyUnavailableReason(provider: ProviderConfig): string | null {
    if (provider.keyPool) {
      const prefix = this.poolPrefix(provider);
      if (this.keyPool.getKeyCount(prefix) > 0) return null;
      // 池空 → 回退单 Key
      if (this.configService.get<string>(provider.apiKeyEnv)) return null;
      const poolLabel = `${prefix.replace(/_$/, '')}_N`;
      return `Key 未配置（${poolLabel} 池空且 ${provider.apiKeyEnv} 缺失）`;
    }
    return this.configService.get<string>(provider.apiKeyEnv) ? null : `环境变量 ${provider.apiKeyEnv} 未配置`;
  }

  /**
   * 默认 provider 可用 ⇔ 注册表有效 且 默认 provider Key 可解析（不静默回退）
   * @returns 整体 AI 是否可用
   */
  isAvailable(): boolean {
    if (!this.config) return false;
    return !this.unavailable.has(this.config.default!);
  }

  private getDefaultName(): string {
    return this.config?.default ?? '';
  }

  /**
   * 解析本次调用的 provider：model 指定则查表，缺省用默认；未知/不可用抛 400
   * @param model - 逻辑名（可选）
   * @returns 含已解析 Key 的 provider
   */
  async resolveProvider(model?: string): Promise<ResolvedProvider> {
    if (!this.config) {
      throw new Error('AI 服务未配置');
    }
    const name = model ?? this.getDefaultName();
    // Object.hasOwn 防原型链绕过（models['__proto__'] 等返回 truthy 可绕过未知模型 400）
    const provider = this.config.models[name];
    if (!Object.hasOwn(this.config.models, name) || !provider || this.unavailable.has(name)) {
      const available = this.listModels()
        .map((m) => m.name)
        .join(', ');
      throw new BadRequestException(`未知模型: ${name}，可用: ${available}`);
    }
    // 解析 Key：池优先（apiKeyEnv 派生池，每模型独立），池空回退单 Key
    const prefix = this.poolPrefix(provider);
    let apiKey: string;
    let keySource: 'pool' | 'env';
    if (provider.keyPool && this.keyPool.getKeyCount(prefix) > 0) {
      apiKey = await this.keyPool.select(prefix);
      keySource = 'pool';
    } else {
      apiKey = this.configService.get<string>(provider.apiKeyEnv)!;
      keySource = 'env';
    }
    return {
      name,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      modelId: provider.modelId,
      smallFastModel: provider.smallFastModel,
      apiKey,
      keySource,
    };
  }

  /**
   * 可用 provider 列表（含 default 标记），供 GET /models
   * @returns 不含不可用 provider，不含敏感字段
   */
  listModels(): ModelInfo[] {
    if (!this.config) return [];
    const def = this.getDefaultName();
    return Object.entries(this.config.models)
      .filter(([name]) => !this.unavailable.has(name))
      .map(([name, provider]) => ({
        name,
        displayName: provider.displayName,
        default: name === def,
      }));
  }
}
