/**
 * 模型注册表类型定义
 *
 * 对应 server/config/models.yaml 的结构与运行时解析结果。
 * Key 永不进入 yaml：apiKeyEnv 引用单个环境变量，keyPool 引用环境变量池（可同时声明，
 * 运行时池优先、池空回退单 Key）。
 */

/** keyPool 声明：true → 全局 LLM_API_KEY_N 池；{ envPrefix } → 独立命名池（如 KIMI_API_KEY_N） */
export type KeyPoolConfig = boolean | { envPrefix: string };

/** yaml 中单个 provider 的声明（非敏感项） */
export interface ProviderConfig {
  displayName: string;
  baseUrl: string;
  modelId: string;
  smallFastModel: string;
  /** 从该环境变量读取单个 API Key（池空时兜底） */
  apiKeyEnv?: string;
  /** 复用 KeyPoolService 轮换（true → 全局池，{ envPrefix } → 命名池） */
  keyPool?: KeyPoolConfig;
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
