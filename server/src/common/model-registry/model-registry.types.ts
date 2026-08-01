/**
 * 模型注册表类型定义
 *
 * 对应 server/config/models.yaml 的结构与运行时解析结果。
 * Key 永不进入 yaml：apiKeyEnv 引用单个环境变量，keyPool 开启池轮换。
 * 池前缀 = apiKeyEnv + '_'（如 DEEPSEEK_API_KEY → DEEPSEEK_API_KEY_N），
 * 每个 model 独立成池，运行时池优先、池空回退单 Key。
 */

/** yaml 中单个 provider 的声明（非敏感项） */
export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  /** 单 Key 来源：从该环境变量读取一个 API Key（同时作为 keyPool 的池前缀基准） */
  apiKeyEnv: string;
  /** 是否开启池轮换：true → 从 apiKeyEnv 派生的独立池（apiKeyEnv_N） */
  keyPool?: boolean;
}

/** models.yaml 解析后的整体结构 */
export interface ModelRegistryConfig {
  default?: string;
  models: Record<string, ProviderConfig>;
}

/** 解析后的 provider（含已解析的 Key 与来源） */
export interface ResolvedProvider {
  name: string;
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  apiKey: string;
  keySource: 'pool' | 'env';
}

/** 暴露给前端的模型信息（不含任何敏感字段） */
export interface ModelInfo {
  name: string;
  displayName: string;
  default: boolean;
}
