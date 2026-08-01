# api-key-pool Specification (Delta)

## MODIFIED Requirements

### Requirement: 多 Key 注册与配置

系统 SHALL 支持通过环境变量注册多个 LLM API Key，每个 Key 使用独立编号的环境变量名称。KeyPool 服务于模型注册表中声明 `keyPool: true` 的 provider，每个 model 独立成池（池前缀 = `apiKeyEnv + '_'`，如 deepseek → `DEEPSEEK_API_KEY_1..N`）；全局 `ANTHROPIC_API_KEY` 不再作为兜底。

#### Scenario: 通过环境变量配置多个 Key

- **WHEN** 某 model 声明 `keyPool: true` 且系统检测到 `DEEPSEEK_API_KEY_1`、`DEEPSEEK_API_KEY_2` 等该模型命名池环境变量
- **THEN** 系统自动加载所有非空的 `{apiKeyEnv}_N` 变量到该模型命名池
- **THEN** 每个 Key 的初始使用计数为 0
- **THEN** 系统日志输出已加载的 Key 数量（不输出 Key 本身）

#### Scenario: 单 Key 配置兼容

- **WHEN** 系统只检测到 `DEEPSEEK_API_KEY_1`
- **THEN** 该模型命名池中仅包含 1 个有效 Key
- **THEN** 系统正常运行，不做轮换

#### Scenario: 无任何 Key 配置

- **WHEN** 某 model 命名池为空且 `apiKeyEnv` 单 Key 缺失
- **THEN** 该 model 标记为不可用（不出现在 `GET /models`，不可解析）
- **THEN** 日志输出警告信息

#### Scenario: 全局 ANTHROPIC_API_KEY 不再作为兜底

- **WHEN** 系统未检测到任何 `{apiKeyEnv}_N` 但存在 `ANTHROPIC_API_KEY`
- **THEN** 所有模型命名池为空（`ANTHROPIC_API_KEY` 不再加载到任何池）
- **THEN** 日志输出警告，引导配置模型注册表
