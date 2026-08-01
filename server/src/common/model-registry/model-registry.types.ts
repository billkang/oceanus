/**
 * 模型注册表类型定义
 *
 * 对应 server/config/models.yaml 的结构与运行时解析结果。
 * Key 永不进入 yaml：apiKeyEnv 引用环境变量名，keyPool 复用 KeyPool 轮换。
 */

/** yaml 中单个 provider 的声明（非敏感项） */
export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  /** 从该环境变量读取 API Key（与 keyPool 二选一） */
  apiKeyEnv?: string;
  /** 复用 KeyPoolService 的 LLM_API_KEY_N 轮换（与 apiKeyEnv 二选一） */
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
