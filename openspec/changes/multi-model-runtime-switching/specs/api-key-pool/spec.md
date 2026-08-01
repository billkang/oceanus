# api-key-pool Specification (Delta)

## MODIFIED Requirements

### Requirement: 多 Key 注册与配置

系统 SHALL 支持通过环境变量注册多个 LLM API Key，每个 Key 使用独立编号的环境变量名称。KeyPool 服务于模型注册表中声明 `keyPool: true` 的 provider（默认 provider）的 Key 轮换；全局 `ANTHROPIC_API_KEY` 不再作为兜底。

#### Scenario: 通过环境变量配置多个 Key

- **WHEN** 系统启动时检测到 `LLM_API_KEY_1`、`LLM_API_KEY_2`、`LLM_API_KEY_3` 等环境变量
- **THEN** 系统自动加载所有非空的 `LLM_API_KEY_N` 变量到 Key 池
- **THEN** 每个 Key 的初始使用计数为 0
- **THEN** 系统日志输出已加载的 Key 数量（不输出 Key 本身）

#### Scenario: 单 Key 配置兼容

- **WHEN** 系统只检测到 `LLM_API_KEY_1`
- **THEN** Key 池中仅包含 1 个有效 Key
- **THEN** 系统正常运行，不做轮换

#### Scenario: 无任何 Key 配置

- **WHEN** 系统未检测到任何 `LLM_API_KEY_N`
- **THEN** Key 池为空
- **THEN** 声明 `keyPool: true` 的 provider 标记为不可用
- **THEN** 日志输出警告信息

#### Scenario: 全局 ANTHROPIC_API_KEY 不再作为兜底

- **WHEN** 系统未检测到 `LLM_API_KEY_N` 但存在 `ANTHROPIC_API_KEY`
- **THEN** Key 池为空（`ANTHROPIC_API_KEY` 不再加载到 Key 池）
- **THEN** 日志输出警告，引导配置模型注册表
