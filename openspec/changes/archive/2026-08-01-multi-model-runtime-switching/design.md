# Design: 多模型注册与运行时切换

## Context

Oceanus 后端通过 Claude Agent SDK 提供 AI 需求讨论能力。当前 `agent.service.ts` 硬编码 `model: 'claude-sonnet-5'`，并依赖全局 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL` 环境变量把整个后端固定指向单一 provider（DeepSeek）。Key 由 `KeyPoolService` 从 `LLM_API_KEY_N` 平铺加载并 Least-Used 轮换，通过调用前突变 `process.env.ANTHROPIC_API_KEY`、调用后恢复的方式注入。

需求：**同时配置多个模型提供方（如 DeepSeek、Kimi），用户在前端手动选择模型，每条消息运行时切换**。

约束（来自讨论）：用户手动选；配置存独立文件；强制注册表为唯一来源（废弃全局 `ANTHROPIC_*` 的 Agent 作用域）；默认 provider 不可用则 AI 整体不可用；`confirm` 续传也携带模型；单模型时前端隐藏选择器。

## Goals / Non-Goals

**Goals:**

- 通过 `server/config/models.yaml` 声明多个 provider（逻辑名 → `displayName`/`baseUrl`/`modelId`/`smallFastModel`/Key 来源）
- 每次 `query()` 按所选 provider 逐调用注入 `model` + `env`（`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`/`ANTHROPIC_SMALL_FAST_MODEL`），消除全局 `process.env` 突变竞态
- `POST /chat` 支持可选 `model` 参数，`message` / `confirm` 均透传；未知 `model` 返回 400
- `GET /models` 暴露可用模型（含 `default` 标记与 `displayName`），不含敏感信息
- 前端输入框上方 `p-dropdown` 选择器，仅多模型时渲染
- Langfuse trace 记录所用模型名

**Non-Goals:**

- 系统自动路由、数据库 models 表 + 管理接口、单次 `query()` 中途换模型、子代理级模型差异化、会话级模型持久化、`fallbackModel` 降级、provider 端点能力补齐、KeyPool 跨 provider 多 Key 抽象
- 全局 `ANTHROPIC_*` 的兼容兜底（本轮直接废弃）

## Decisions

### D1：配置载体 = 独立 YAML 文件 `server/config/models.yaml`

**选择**：独立配置文件，而非平铺 env 或 JSON blob。
**理由**：用户明确选配置文件；YAML 可注释、可读性好，适合嵌套的 provider 结构；Key 用 `apiKeyEnv` 引用环境变量（见 D2），文件本身非敏感、可提交、可放 `models.example.yaml` 模板。
**代价**：引入 `yaml` 依赖；配置改动需重启生效。
**替代方案**：平铺 env（`MODEL_PROVIDER_DEEPSEEK_BASE_URL` 等）——与现有约定一致但每 provider 5+ 行且无法注释；JSON blob env——`.env` 内嵌嵌套 JSON 难维护。均被否。

```yaml
# server/config/models.yaml
default: deepseek
models:
  deepseek:
    displayName: DeepSeek
    baseUrl: https://api.deepseek.com/anthropic
    modelId: claude-sonnet-5 # 当前生产已验证可运行的模型串（DeepSeek Anthropic 端点接受）
    smallFastModel: deepseek-v4-flash
    keyPool: true # 复用 LLM_API_KEY_N 轮换
  kimi:
    displayName: Kimi K2
    baseUrl: https://api.moonshot.ai/anthropic
    modelId: kimi-k2.7-code
    smallFastModel: kimi-k2.5
    apiKeyEnv: KIMI_API_KEY
```

### D2：Key 隔离 — `apiKeyEnv` 引用环境变量 / `keyPool: true` 复用 KeyPool

**选择**：yaml 只放非敏感项；Key 来源两种：`apiKeyEnv`（读 `ConfigService.get(envName)`）或 `keyPool: true`（`KeyPoolService.select()` Least-Used 轮换）。
**理由**：Key 永不进版本库，延续 `.env` 管理习惯（grill 决策）；默认 provider 保留多 Key 轮换能力，现有 `LLM_API_KEY_N` 部署零迁移。
**注意**：`keyPool: true` 仅用于默认 provider 场景；`KeyPoolService.loadKeysFromEnv` 移除 `ANTHROPIC_API_KEY` 兜底（该全局变量废弃）。

### D3：`query()` 注入方式 = `env` 合并模式 + `model`

**选择**：每次调用传 `env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_SMALL_FAST_MODEL }`（provider 覆盖）与 `model: provider.modelId`；**删除**现有 `process.env.ANTHROPIC_API_KEY = key` / finally 恢复的突变逻辑。
**理由**：SDK 官方文档的 `env` 示例即 `{ ...process.env, KEY: value }` 合并模式，传完整合并 dict 可确保子进程看到 provider 覆盖，与实现无关；消除全局突变在并发下的竞态隐患。
**风险缓解**：并发仍受 `MAX_CONCURRENT_LLM=3` 与 RequestQueue 约束，但改后不再依赖该约束保证正确性。

### D4：注册表服务 `ModelRegistryService`（新模块）

**选择**：新增 `server/src/common/model-registry/model-registry.service.ts` + module，`onModuleInit` 加载并校验 yaml。
**接口**：

- `isAvailable(): boolean` — 注册表有效 且 默认 provider 可用（Key 已解析）
- `resolveProvider(model?: string): ResolvedProvider` — 有 `model` 则查表（未知/不可用 → 抛 `BadRequestException`，错误信息含可用列表）；无则默认 provider。返回 `{ name, baseUrl, modelId, smallFastModel, apiKey, keySource }`
- `listModels(): ModelInfo[]` — 可用 provider 的 `{ name, displayName, default }`
  **默认 provider 规则**：`default` 显式声明优先，缺省回退第一个有效 provider（WARN）。
  **可用性规则**（grill 决策）：默认 provider Key 不可用 → 整体 `available=false`，发消息报 `ai_not_configured`，不静默回退。

### D5：`GET /models` 挂 ChatController

**选择**：在现有 `@Controller()` 的 `ChatController` 新增 `@Get('models')`（同 JWT 守卫），返回 `registry.listModels()`。
**理由**：零新增模块结构，复用现有鉴权与文档基建；语义上"当前可用的聊天模型"归 chat 域可接受。
**返回**：`[{ name: 'deepseek', displayName: 'DeepSeek', default: true }, { name: 'kimi', displayName: 'Kimi K2', default: false }]`

### D6：模型参数透传链

**选择**：`ChatRequestDto` 新增 `model?: string`（`@IsOptional() @IsString()`）→ `ChatController` 传入 `sendAndStream`/`confirmAndStream` options → `ChatService` 透传 → `agentService.sendMessage(content, { resume?, model })`。
**confirm 延续**（grill 决策）：前端 `action: 'confirm'` 请求也携带 `model`（当前选择器状态），避免续传漂移回默认 provider。
**取消**：`cancel` 不需要 `model`。

### D7：AgentService 可用性语义重构

**选择**：constructor 不再读 `ANTHROPIC_API_KEY` 判 `available`，改为注入 `ModelRegistryService`，`isAvailable()` = `registry.isAvailable()`。
**影响**：`AiNotConfigured` 事件触发条件从"缺 Key"变为"注册表缺失/非法/默认 provider 不可用"，WARN 文案同步更新。

### D8：Langfuse 模型名可观测性

**选择**：`LangfuseService.createTrace(sdkSessionId, projectId?, model?)` 增加可选 `model` 参数，作为 tag `model:<逻辑名>` 记入 trace。
**接入**：`agent.service.ts` 在 `buildLangfuseHooks()` 的 `SessionStart` hook 闭包中捕获本次已解析的 provider 逻辑名，传入 `createTrace`。

### D9：前端模型选择器

**选择**：`client/src/app/chat/chat.service.ts` 新增 `getModels()`（GET `/api/v1/models`）；`chat.component` 初始化拉取模型列表，`models.length > 1` 时在输入区上方渲染 PrimeNG `p-dropdown`（默认选中 `default: true` 项），发送消息与 confirm 请求携带所选 `model`。
**理由**：单一事实来源在后端；单模型隐藏避免无意义 UI（grill 决策）。

## Change Scope Matrix

| 层          | 变更                                            | 文件                                                                               |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| BE 配置     | 新增 `models.yaml` + `models.example.yaml` 模板 | `server/config/`                                                                   |
| BE 新模块   | 模型注册表加载/校验/解析/列表                   | `server/src/common/model-registry/`（新增）                                        |
| BE Agent    | 注册表解析 + `env` 逐调用注入 + 可用性重构      | `server/src/agent/agent.service.ts`                                                |
| BE Chat     | DTO/controller/service 透传 `model`             | `server/src/chat/dto/chat-request.dto.ts`、`chat.controller.ts`、`chat.service.ts` |
| BE KeyPool  | 移除 `ANTHROPIC_API_KEY` 兜底                   | `server/src/common/key-pool/key-pool.service.ts`                                   |
| BE API      | `GET /models`                                   | `server/src/chat/chat.controller.ts`                                               |
| BE Langfuse | `createTrace` 可选 `model` 参数                 | `server/src/common/langfuse/langfuse.service.ts`                                   |
| FE          | 模型列表拉取 + 条件渲染选择器 + 透传            | `client/src/app/chat/chat.service.ts`、`chat.component.ts`、`chat.component.html`  |
| 依赖        | 新增 `yaml`                                     | `server/package.json`                                                              |
| 文档        | env 迁移、API、ADR                              | `docs/`、`.deepstorm/context.md`                                                   |

## API Contract

### `GET /api/v1/models`（Bearer JWT）

```
200 OK
[
  { "name": "deepseek", "displayName": "DeepSeek", "default": true },
  { "name": "kimi",     "displayName": "Kimi K2",   "default": false }
]
```

- 401：未认证
- 不返回不可用 provider（Key 缺失）；不含 `baseUrl` / Key / `apiKeyEnv`

### `POST /api/v1/chat` — 新增字段

`ChatRequestDto` 新增可选字段 `model?: string`（逻辑名）。

```
// message
{ "action": "message", "content": "...", "model": "kimi" }
// confirm — 也携带 model，避免续传漂移
{ "action": "confirm", "sessionId": "...", "confirmOption": "...", "model": "kimi" }
```

- 缺省 `model`：使用默认 provider（行为同现状）
- 未知或不可用 `model`：`400 BadRequest`，错误信息含可用列表（如 `未知模型: unknown，可用: deepseek, kimi`）

## Risks / Trade-offs

- **[Kimi 端点官方文档不完善]**（document 内容块 400、多轮 tool-calling 时 thinking 块可能 400、prompt caching 未验证）→ 实现时对 Kimi 做冒烟测试（单轮 + 多轮 + 工具调用各一发）；不支持的请求形态由 SDK/端点自然降级或报错，不为此补能力。
- **[跨 provider resume 未实测]** → 设计上允许自由切换（grill 决策）；实现阶段测"deepseek 会话续传 kimi"；异常时用户开新会话自救，不阻断功能。
- **[默认 provider 不可用 = AI 全禁用]** → 属有意为之（不静默回退）；WARN 文案需明确引导"检查 models.yaml 与 Key"，避免用户困惑。
- **[breaking：全局 `ANTHROPIC_*` 废弃]** → 升级顺序：先落 `models.yaml`（含 deepseek 配置）再切版本；未配置时 AI 安全降级禁用而非崩溃；迁移文档写明差异。
- **[`modelId` 字符串 provider 相关]** → deepseek 保持现状已验证值 `claude-sonnet-5`；kimi 用真实 ID；配置驱动，接入新 provider 时按其端点文档填值。
- **[`env` 合并注入的密钥可见性]** → `env` dict 只进 SDK 子进程，不落日志（现有 pino serializer 不输出 env）；日志中避免打印 Key。

## Migration Plan

1. **配置先行**：新增 `server/config/models.yaml`（内置 deepseek 完整条目 + kimi 示例）+ `models.example.yaml`；`.env` 增加 `KIMI_API_KEY`（deepseek 沿用现有 `LLM_API_KEY_N`）；`.env.example` 补充迁移说明。
2. **后端**：新增 `model-registry` 模块 → `agent.service.ts` 重构（`sendMessage` 签名、`env` 注入、`available` 语义）→ chat 透传 + DTO + `GET /models` → KeyPool 去兜底 → Langfuse `createTrace` 扩展。
3. **前端**：`chat.service.getModels()` + 组件选择器 + 请求带 `model`。
4. **文档**：`docs/1-getting-started/`（env 迁移：`ANTHROPIC_*` → `models.yaml` + per-provider Key）、`docs/3-api/api-reference.md`（`POST /chat` 新字段 + `GET /models`）、ADR-013、`.deepstorm/context.md` 同步。
5. **部署/回滚**：注册表未配置 → AI WARN 禁用（安全降级）；回滚 = revert 本 change + 恢复 `.env` 全局 `ANTHROPIC_*`。

## Open Questions

- Kimi 实际可用模型 ID 与端点冒烟结果（需实现阶段以真实 Key 实测确认，`kimi-k2.7-code` 仅为当前搜索到的候选）。
- deepseek 的 `modelId` 是否保持 `claude-sonnet-5`（当前已验证值）还是切换为其真实模型 ID——默认保持现状，避免行为漂移。
