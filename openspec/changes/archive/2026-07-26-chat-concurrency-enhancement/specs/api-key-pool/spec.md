## ADDED Requirements

### Requirement: 多 Key 注册与配置

系统 SHALL 支持通过环境变量注册多个 LLM API Key，每个 Key 使用独立编号的环境变量名称。

#### Scenario: 通过环境变量配置多个 Key

- **WHEN** 系统启动时检测到 `LLM_API_KEY_1`、`LLM_API_KEY_2`、`LLM_API_KEY_3` 等环境变量
- **THEN** 系统自动加载所有非空的 `LLM_API_KEY_N` 变量到 Key 池
- **THEN** 每个 Key 的初始使用计数为 0
- **THEN** 系统日志输出已加载的 Key 数量（不输出 Key 本身）

#### Scenario: 单 Key 配置兼容

- **WHEN** 系统只检测到 `LLM_API_KEY_1`（或仅 `ANTHROPIC_API_KEY`）
- **THEN** Key 池中仅包含 1 个有效 Key
- **THEN** 系统正常运行，不做轮换

#### Scenario: 无任何 Key 配置

- **WHEN** 系统未检测到任何 `LLM_API_KEY_N` 且 `ANTHROPIC_API_KEY` 为空
- **THEN** Key 池为空
- **THEN** `/chat` 接口返回 AI 不可用错误
- **THEN** 系统日志输出警告信息

### Requirement: Least-Used Key 选择

系统 SHALL 在选择 Key 时使用 Least-Used 策略，优先选择累计使用次数最少的 Key。

#### Scenario: 正常轮换选择

- **WHEN** Key 池中有 3 个 Key，使用计数分别为 {K1: 5, K2: 3, K3: 8}
- **THEN** 系统选择 K2（使用次数最少）
- **THEN** K2 的使用计数 +1

#### Scenario: 多 Key 计数相同时随机选择

- **WHEN** Key 池中 K1 和 K2 使用计数相同（均为 5）
- **THEN** 系统在 K1 和 K2 之间随机选择一个
- **THEN** 被选中 Key 的使用计数 +1

### Requirement: Key 故障自动切换

系统 SHALL 在检测到当前 Key 请求失败时自动切换到下一个可用的 Key，并记录故障。

#### Scenario: 429 速率限制触发切换

- **WHEN** 当前 Key 调用 LLM API 返回 429
- **THEN** 系统自动从 Key 池中选择下一个使用次数最少的 Key 重试
- **THEN** 原 Key 的故障计数 +1
- **THEN** 重试次数不超过 `LLM_API_MAX_RETRIES`（默认 3；Rationale：3 次重试覆盖了最常见的瞬态故障模式——1 次 429 后切换 Key 再试、1 次网络抖动恢复后重试、最后 1 次兜底；超过 3 次说明不是瞬态问题），超限后向用户返回错误

#### Scenario: 网络错误触发切换

- **WHEN** 当前 Key 调用 LLM API 超时或网络连接失败
- **THEN** 系统自动切换到下一个可用 Key 重试
- **THEN** 原 Key 的故障计数 +1

#### Scenario: 所有 Key 均失败

- **WHEN** Key 池中所有 Key 尝试均失败（全部 429 或网络错误）
- **THEN** 系统向用户返回 503 错误："AI 服务暂时不可用，请稍后重试"
- **THEN** 系统日志记录所有 Key 的故障详情

### Requirement: Key 使用计数持久化（跨进程）

系统 SHALL 在 Cluster 模式下通过 Redis 共享 Key 使用计数和故障状态。

#### Scenario: Cluster 多 Worker 共享状态

- **WHEN** Cluster 有 4 个 worker，worker-1 选择了 K1 并递增计数
- **THEN** worker-2 读取到的 K1 计数已包含 worker-1 的递增
- **THEN** 全局 Least-Used 选择一致

#### Scenario: 单进程模式降级

- **WHEN** Redis 不可用（未配置或连接失败）
- **THEN** 系统降级为内存计数（仅当前进程有效）
- **THEN** 系统日志输出 Redis 不可用警告
- **THEN** 不影响正常请求处理
