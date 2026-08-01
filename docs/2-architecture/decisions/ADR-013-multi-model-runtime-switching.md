# ADR-013: 多模型注册与运行时切换

- **日期**: 2026-08-01
- **状态**: 已接受
- **关联**: ADR-002（AI 引擎选型）、ADR-003（并发控制架构）、ADR-008（会话连续性）

## 背景

AI 调用硬编码单一模型 `claude-sonnet-5`，Key 经全局 `process.env.ANTHROPIC_API_KEY` 突变注入，无法按模型切换 provider 与 Key 池，多 Key 只能堆在 `LLM_API_KEY_N` 一个池里。

## 决策

1. **配置载体 = 独立 YAML**：`server/config/models.yaml`（含 `models.example.yaml` 模板）。Key 永不进 yaml，经 `apiKeyEnv` 引用环境变量。
2. **Key 隔离与独立池**：`keyPool: true` → 池前缀 = `apiKeyEnv + '_'`（`DEEPSEEK_API_KEY` → `DEEPSEEK_API_KEY_N`），**每模型独立池，切模型即切池**；运行时池优先、池空回退单 Key（`apiKeyEnv`）。全局 `LLM_API_KEY_N` 池与 `ANTHROPIC_API_KEY` 兜底废弃。
3. **注入方式 = env 合并 + model**：每次调用传 `env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_SMALL_FAST_MODEL }`（provider 覆盖）+ `model: provider.modelId`；删除全局 `process.env.ANTHROPIC_API_KEY` 突变/恢复逻辑，消除并发竞态。
4. **注册表服务**：新增 `ModelRegistryService`，`onModuleInit` 加载校验 yaml。`isAvailable()` = 注册表有效 且 默认 provider 可用（不静默回退）；`resolveProvider(model?)` 未知/不可用抛 400（错误含可用列表）；`listModels()` 返回 `{ name, displayName, default }`。`default` 显式声明优先，缺省回退第一个 provider（WARN）。
5. **`GET /models`**：挂 ChatController（同 JWT 守卫），返回 `listModels()`，作为前端选择器的单一事实来源。
6. **透传链**：`ChatRequestDto.model?` → `sendAndStream`/`confirmAndStream` → `sendMessage(content, { resume?, model })`。confirm 请求同样携带 `model`（避免续传漂移回默认 provider）；`cancel` 不携带。
7. **可用性语义重构**：AgentService constructor 不再读 `ANTHROPIC_API_KEY` 判可用性，`isAvailable()` 委托 registry。
8. **可观测性**：`createTrace(sdkSessionId, projectId?, model?)` 增加可选 `model` 参数，记 tag `model:<逻辑名>` 入 trace。
9. **前端选择器**：`getModels()` 拉取列表；`models.length > 1` 时渲染 PrimeNG `p-select`（默认选中 `default: true` 项），message/confirm 携带所选 `model`；单模型隐藏选择器。
10. **模型开关**：`enabled?: boolean`，`enabled: false` → **完全隐藏**（不出现在 listModels、不可解析，相当于下线）；省略默认启用；默认 provider 被禁用时 `isAvailable()` 为 false。

## 权衡

- 配置文件改动需重启生效；引入 `yaml` 依赖
- 每模型独立池让 Key 分布更分散，但避免跨 provider 池污染；池前缀从 `apiKeyEnv` 派生，新增 provider 无需额外声明池名
- `enabled` 只做整模型下线，不做模型级 key 独立启停
- 不做：系统自动路由、数据库 models 表 + 管理接口、单次 `query()` 中途换模型、子代理级模型差异化、会话级模型持久化、`fallbackModel` 降级、KeyPool 跨 provider 多 Key 抽象
- 全局 `ANTHROPIC_*` 兼容兜底直接废弃（迁移成本由开发者承担）
