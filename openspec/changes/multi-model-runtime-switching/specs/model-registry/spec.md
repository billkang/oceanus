## ADDED Requirements

### Requirement: 模型注册表加载

系统 SHALL 在启动时从 `server/config/models.yaml` 加载模型注册表，包含默认 provider 与各 provider 的 `displayName` / `baseUrl` / `modelId` / `smallFastModel` / Key 来源（`apiKeyEnv` 或 `keyPool`）。

#### Scenario: 正常加载

- **WHEN** `models.yaml` 存在且包含 `default` 指定的 provider 与至少一个有效 provider 条目
- **THEN** 注册表加载成功，默认 provider 确定为 `default` 指定的逻辑名
- **THEN** 每个 provider 的 `baseUrl` / `modelId` / `smallFastModel` / Key 来源可用

#### Scenario: 文件缺失

- **WHEN** `models.yaml` 不存在或路径不可读
- **THEN** 服务正常启动但 Agent 功能禁用（available=false）
- **THEN** 日志输出 WARN 提示注册表缺失

#### Scenario: 配置非法

- **WHEN** `models.yaml` 解析失败（YAML 语法错误）或存在缺必填字段的无效 provider
- **THEN** 服务正常启动但 Agent 功能禁用（available=false）
- **THEN** 日志输出 WARN 提示注册表非法及原因

#### Scenario: 默认 provider 未显式声明

- **WHEN** `models.yaml` 存在但未声明 `default`
- **THEN** 回退使用第一个有效 provider 作为默认
- **THEN** 日志输出 WARN 提示未显式声明 default

### Requirement: Key 来源解析

系统 SHALL 根据 provider 的 Key 来源配置解析 API Key：`keyPool: true` 从 `LLM_API_KEY_N` Key 池轮换，否则从 `apiKeyEnv` 指定的环境变量读取。

#### Scenario: keyPool 默认 provider 轮换

- **WHEN** 默认 provider 声明 `keyPool: true` 且存在 `LLM_API_KEY_1` / `LLM_API_KEY_2`
- **THEN** 每次调用经 KeyPool 按 Least-Used 策略选择 Key

#### Scenario: apiKeyEnv 单 Key

- **WHEN** provider 声明 `apiKeyEnv: KIMI_API_KEY` 且该环境变量已配置
- **THEN** 该 provider 使用该 Key，不做轮换

#### Scenario: apiKeyEnv 缺失

- **WHEN** provider 声明的 `apiKeyEnv` 对应环境变量未配置
- **THEN** 该 provider 标记为不可用
- **THEN** 日志输出 WARN 提示 Key 缺失
- **THEN** `GET /models` 不返回该 provider

#### Scenario: 默认 provider Key 缺失

- **WHEN** 默认 provider 的 Key 来源（`keyPool` 池为空 或 `apiKeyEnv` 缺失）导致其不可用
- **THEN** 整个 Agent 功能视为不可用（available=false）
- **THEN** 发送消息返回 `ai_not_configured`，不静默回退到其他 provider

### Requirement: 模型解析与参数校验

系统 SHALL 将请求携带的 `model` 逻辑名解析为对应 provider 配置；未知或不可用的 `model` 返回 400。

#### Scenario: 合法模型解析

- **WHEN** 请求携带 `model: 'kimi'` 且 kimi 已注册且可用
- **THEN** 系统使用 kimi 的 `baseUrl` / `modelId` / Key 发起调用

#### Scenario: 未知模型拒绝

- **WHEN** 请求携带 `model: 'unknown'` 或已禁用（Key 缺失）的 provider
- **THEN** 返回 400，错误信息包含可用模型列表

#### Scenario: 缺省模型

- **WHEN** 请求未携带 `model`
- **THEN** 系统使用默认 provider

### Requirement: query 逐调用注入

系统 SHALL 在每次 `query()` 调用时，将所选 provider 的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL` 通过 `query()` 的 `env` 选项注入，主模型通过 `model` 选项指定。

#### Scenario: 逐调用 provider 覆盖

- **WHEN** 连续两次调用分别选择 deepseek 与 kimi
- **THEN** 每次调用的 `env` 覆盖与 `model` 各自对应所选 provider
- **THEN** 两次调用互不影响，不依赖全局 `process.env` 突变

#### Scenario: 全局环境变量不参与

- **WHEN** 注册表可用
- **THEN** 全局 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL` 不再被 Agent 调用读取

### Requirement: GET /models 端点

系统 SHALL 提供 `GET /models` 端点，返回可用模型的逻辑名与显示名，不含任何敏感信息。

#### Scenario: 正常返回

- **WHEN** 已认证前端请求 `GET /models`
- **THEN** 返回数组，每项含 `name`（逻辑名）、`displayName`（来自 `models.yaml`）与 `default`（布尔，标记默认 provider）
- **THEN** 响应不包含 `baseUrl` / `apiKeyEnv` / 任何 Key 或密钥
- **THEN** 不可用 provider（Key 缺失）不出现

#### Scenario: 未认证请求

- **WHEN** 请求未携带有效 JWT
- **THEN** 返回 401

### Requirement: 模型选择器条件渲染

前端 SHALL 仅在可用模型多于 1 个时渲染模型选择器；仅 1 个可用模型时不渲染，消息使用默认模型。

#### Scenario: 多模型时渲染选择器

- **WHEN** `GET /models` 返回 ≥2 个可用模型
- **THEN** 前端在聊天输入框上方渲染模型选择器，默认选中默认 provider

#### Scenario: 单模型时隐藏选择器

- **WHEN** `GET /models` 仅返回 1 个可用模型
- **THEN** 前端不渲染模型选择器
- **THEN** 消息请求不携带 `model` 参数，后端使用默认 provider
