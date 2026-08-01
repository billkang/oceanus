# Proposal: 多模型注册与运行时切换

## Why

Oceanus 当前的 AI 集成在 `agent.service.ts` 中硬编码 `model: 'claude-sonnet-5'`，通过全局 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL` 环境变量把整个后端固定指向单一 provider（当前为 DeepSeek）。用户希望**同时配置多个模型提供方**（如 DeepSeek、Kimi），并能在**运行时为每条消息手动选择模型**。当前要做到这一点只能改 `.env` 后重启服务，无法按消息切换。

## What Changes

- 新增**模型注册表**：独立配置文件 `server/config/models.yaml`（非敏感项 + `apiKeyEnv` 引用环境变量中的 Key）；第一版内置 `deepseek` + `kimi` 两 provider 示例
- **强制注册表为唯一来源**：废弃全局 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL` 对 Agent 的作用域（**BREAKING**，需迁移 `models.yaml`）；注册表缺失/解析失败/无有效 provider → 降级禁用 AI + WARN（与现有 `ANTHROPIC_API_KEY` 缺失的降级模式一致，不静默回退旧配置）
- `agent.service.ts`：去掉硬编码 `model: 'claude-sonnet-5'`，按所选模型从注册表解析；API Key 注入从 `process.env` 全局突变改为 `query()` 的 `env` **逐调用覆盖**（含 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL`），消除现有全局环境变量切换的竞态隐患
- **KeyPool 保留默认 provider 的多 Key 轮换**：默认 provider 在 `models.yaml` 声明 `keyPool: true` → 沿用 `LLM_API_KEY_N` Least-Used 轮换；其他 provider 用 `apiKeyEnv` 单 Key；移除 KeyPool 内已废弃的 `ANTHROPIC_API_KEY` 兜底
- `ChatRequestDto` 新增可选 `model` 字段（逻辑名），`POST /chat` 透传 → `chatService.sendAndStream` → `agentService.sendMessage`；缺省使用默认 provider；**未知 `model` 返回 400**（错误信息列出可用模型）
- **新增 `GET /models` 端点**：返回可用模型逻辑名 + 显示名（不含 `baseUrl` / Key 等敏感信息），供前端选择器渲染
- **同会话内可自由切换模型**：`resume` 照常进行，每条消息独立携带自己的 `model`（跨 provider 续传风险标注并实测）
- 前端聊天输入框上方新增 PrimeNG `p-dropdown` **模型选择器**，随消息发送 `model` 参数，展示当前选中模型；**仅当可用模型多于 1 个时渲染**，单模型时不展示选择器、消息走默认 provider
- Langfuse 可观测性追踪带上 `model` 名，便于按模型分析 trace
- `.env.example` / 文档同步迁移说明；新增 ADR

## Capabilities

### New Capabilities

- `model-registry`: 多模型提供方注册表（`models.yaml`）的加载、校验与模型解析；默认 provider / `apiKeyEnv` / `keyPool` 三种 Key 来源；`query()` 逐调用 `model` + `env` 注入；配置缺失/非法的降级处理；`GET /models` 暴露可用模型列表

### Modified Capabilities

- `agent-integration`: `oceanus-tide` Agent 初始化由硬编码 `model: 'claude-sonnet-5'` + 全局 `process.env` 注入，改为按所选模型从注册表解析，并通过 `query()` 的 `env` 选项注入 provider 级环境变量
- `api-key-pool`: 移除 `ANTHROPIC_API_KEY` 兜底加载（该全局变量废弃），`LLM_API_KEY_N` 轮换语义不变，并明确其服务对象为默认 provider

## Impact

- **后端**：`server/src/agent/agent.service.ts`（注册表解析 + `env` 逐调用覆盖）、`server/src/chat/chat.service.ts`（透传 `model`）、`server/src/chat/chat.controller.ts` + `dto/chat-request.dto.ts`（新增可选 `model` 字段）、`server/src/common/key-pool/key-pool.service.ts`（移除 `ANTHROPIC_API_KEY` 兜底）、新增 `models.yaml` 加载模块与 `GET /models` 端点
- **前端**：`client/src/app/chat/` 聊天组件（`p-dropdown` 模型选择器 + 请求参数 + 当前模型展示）
- **配置**：`server/config/models.yaml`（新增，含 `models.example.yaml` 模板）、`server/.env.example`（迁移说明 + per-provider Key）、`server/.env`（本地）
- **依赖**：新增 `yaml`（解析 `models.yaml`）
- **文档**：`docs/1-getting-started/`（env 迁移）、`docs/3-api/api-reference.md`（`POST /chat` 新字段 + `GET /models`）、`docs/2-architecture/decisions/`（新增 ADR-013）

## Out of Scope

- ❌ **系统自动路由**：按成本 / 队列 / 会话类型自动分配模型（v2 视需求）
- ❌ **数据库 models 表 + 管理接口**：配置文件足够，不做 Prisma schema 变更与运行时热更新（v2 可迁 DB）
- ❌ **单次 `query()` 执行中途换模型**：SDK 主循环绑定单模型，技术不可行
- ❌ **子代理级模型差异化**：统一使用 provider 的 `smallFastModel` 槽位
- ❌ **会话级模型持久化到 DB**：前端选择器状态随消息发送即可，刷新丢失属可接受
- ❌ **`fallbackModel` 自动降级 / 容错**：模型调用失败走现有报错路径
- ❌ **provider 端点能力补齐**：vision / document / prompt caching 依赖端点原生能力，Kimi 不支持的请求形态不发
- ❌ **KeyPool 扩展为跨 provider 多 Key 抽象**（ProviderPool）：默认 provider 保留 `LLM_API_KEY_N` 轮换即可，其余 provider 单 Key
- ❌ **全局 `ANTHROPIC_*` 的兼容兜底**：本轮直接废弃（breaking），不做双轨

## Known Limitations

- **Kimi 端点官方文档不完善**（[MoonshotAI/Kimi-K2#129](https://github.com/MoonshotAI/Kimi-K2/issues/129)）：`document` 内容块返回 400、多轮 tool-calling 时 `thinking` 块可能 400、prompt caching 未验证——需实测，不支持的形态不发。
- **Key 平台不互通**：`api.moonshot.ai`（开发者 API）≠ `api.kimi.com/coding`（订阅）≠ `api.moonshot.cn`，注册表内 `apiKeyEnv` 指向的 Key 必须与 `baseUrl` 配对，配错将静默失败。
- **Kimi 免费额度 3 RPM** 基本不可用，需充值至 Tier1（200 RPM）方可实际使用。
- **Kimi 温度重缩放（×0.6）且 K2.7 Code 强制思考**：输出随机性与推理成本与 DeepSeek 行为不同，按消息切模型后成本曲线会变化。
- **`models.yaml` 改动需重启生效**：注册表不做运行时热更新，切换 provider 需重启 server。
- **resume 跨 provider 续传未验证**：SDK 允许 query 时传 `model`，JSONL 会话内容 provider 无关，但跨 provider 续传行为需实测确认。
- **breaking change 影响现有部署**：升级需先创建 `models.yaml`，否则 AI 降级禁用（WARN 可见）。
- **默认 provider 单点健康**：默认 provider 的 Key 池耗尽/失效时 AI 整体禁用（有意为之，不静默回退）；需运维监控默认 provider 的健康状态，避免因单个 provider 故障导致全平台 AI 不可用。
- **模型可用性仅在启动快照**：注册表启动时校验一次 Key 有效性，运行期 Key 被撤销/限流不会刷新；`GET /models` 返回的 provider 在消息调用时可能已失效，需在错误路径兜底提示。
- **`modelId` 为端点私有魔数**：`modelId` 是各 provider 端点自有的模型串（deepseek 当前沿用已验证的 `claude-sonnet-5`，非其真实模型 ID），provider 收紧模型校验时可能失效，需在端点升级时回归验证。
