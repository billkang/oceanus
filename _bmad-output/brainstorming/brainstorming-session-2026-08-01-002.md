# Brainstorming Session

- **日期**: 2026-08-01
- **Change**: `multi-model-runtime-switching`
- **状态**: ✅ 讨论完成

---

## 讨论主题

为 Oceanus 的 AI 调用支持**多模型运行时动态切换**：通过配置文件注册多个模型提供方（如 DeepSeek、Kimi），用户在聊天界面**手动选择模型**，每次消息发送时携带所选模型，后端逐调用切换。

现状：`ANTHROPIC_BASE_URL` 等变量在 `.env` 全局固定指向 DeepSeek（`https://api.deepseek.com/anthropic`），`agent.service.ts` 硬编码 `model: 'claude-sonnet-5'`，KeyPool 仅轮换单 provider 的 Key，无法配置多个模型。

## 关键决策

| #   | 决策                                                                                                          | 理由                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 触发方式 = **用户手动选**（前端模型选择器），不做系统自动路由                                                 | 最直接回答原始诉求；路由策略涉及成本/队列/会话类型多维判定，推迟                                                                               |
| 2   | 模型注册表存放 = **配置文件**（server 端 config / env），不做数据库 models 表 + 管理接口                      | 无需 Prisma schema 变更、无管理 UI，第一版最小改动；代码按 ProviderPool 可替换数据源设计，二期可迁 DB                                          |
| 3   | 注册表条目 = 逻辑名 → `{ baseUrl, apiKey, modelId, smallFastModel }`                                          | 每个 provider 需独立 `ANTHROPIC_BASE_URL`（Anthropic 兼容端点）+ 自己的 Key + 主模型 ID + 后台模型 ID                                          |
| 4   | AgentService 改造：去掉硬编码 `model`，按所选模型解析；`process.env` 全局注入 → `query()` 的 `env` 逐调用覆盖 | SDK `query({ options: { model, env } })` 原生支持逐调用指定模型与覆盖环境变量；顺带消除现 KeyPool 全局突变 + `MAX_CONCURRENT_LLM=3` 的竞态隐患 |
| 5   | Chat API：消息发送接口新增可选 `model` 参数（逻辑名），缺省 `deepseek`                                        | 向后兼容：前端不发则走默认 provider，行为不变                                                                                                  |
| 6   | 前端：聊天输入区加模型选择器，每条消息随附所选模型                                                            | 无会话级持久化，选择器状态放前端组件即可                                                                                                       |
| 7   | 每个 provider 必须配置 `ANTHROPIC_SMALL_FAST_MODEL` 后台模型槽位                                              | 后台/子代理任务（小模型）若不随 provider 切换会打到错误模型                                                                                    |
| 8   | KeyPool 语义保持"单 provider 多 Key 轮换"；跨 provider 的 Key 隔离在注册表内                                  | MVP 每个 provider 单 Key；多 Key 轮换需求仅 DeepSeek 存在，不扩展为 ProviderPool 全量抽象                                                      |

## 需求要点

1. **模型注册表**：配置文件定义 `deepseek` + `kimi` 两 provider，含 `baseUrl` / `apiKey` / `modelId` / `smallFastModel`；`.env.example` 同步示例与语义注释
2. **agent.service.ts**：`model: 'claude-sonnet-5'` 硬编码 → 按所选模型从注册表解析；Key 注入从 `process.env` 全局突变改为 `query()` 的 `env` 逐调用覆盖（含 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` / `ANTHROPIC_SMALL_FAST_MODEL`）
3. **chat.service.ts / 消息接口**：透传 `model` 参数，缺省回退默认 provider
4. **前端**：聊天输入区模型选择器，随消息发送模型参数；展示当前选中模型
5. **可观测性**：Langfuse 追踪带上 `model` 名，便于按模型分析
6. **文档同步**：`.env.example`、API 文档（`docs/3-api/api-reference.md`）、新增 ADR（模型注册与运行时切换）

## 边界范围（不做的）

- ❌ 系统自动路由（成本/队列/会话类型自动分配）
- ❌ 数据库 models 表 + 管理接口 / 运行时热更新配置
- ❌ 单次 `query()` 执行中途换模型（SDK 主循环绑定单模型，技术不可行）
- ❌ 子代理级模型差异化（统一用 provider 的 `smallFastModel`）
- ❌ 会话级模型持久化到 DB（刷新/换浏览器丢失选择属可接受）
- ❌ `fallbackModel` 自动降级/容错（模型失败走现有报错路径）
- ❌ provider 端点能力补齐（vision / document / prompt caching，依赖端点原生能力）
- ❌ 将 KeyPool 扩展为跨 provider 的多 Key 抽象（MVP 每 provider 单 Key）

## 注意事项（约束与风险）

1. **前置依赖已满足**：Kimi 提供 Anthropic 兼容端点 `https://api.moonshot.ai/anthropic`（国际）/ `https://api.moonshot.cn/anthropic`（国内），模型 ID 如 `kimi-k2.7-code`、`kimi-k2.5`；需在实现时确认 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 哪种被 Kimi 端点接受
2. **Kimi 端点官方文档不完善**（MoonshotAI/Kimi-K2#129）：`document` 内容块 400、多轮 tool-calling 时 `thinking` 块可能 400、prompt caching 未验证 → **需实测**，不支持的请求形态不发
3. **Key 平台不互通**：`api.moonshot.ai`（开发者 API）≠ `api.kimi.com/coding`（订阅）≠ `api.moonshot.cn`，注册表 Key 必须与 baseUrl 配对
4. **Kimi 免费额度 3 RPM** 基本不可用，需充值至 Tier1（200 RPM）
5. **Kimi 温度重缩放（×0.6）** 且 K2.7 Code 强制思考，输出成本/随机性需留意
6. **`ANTHROPIC_SMALL_FAST_MODEL` 槽位每 provider 必配**，否则后台子任务打到错误 provider
7. **resume 跨 provider 续传**：SDK 允许 query 时传 `model`，但跨 provider 续传需实测（JSONL 会话内容 provider 无关，大概率可行）
8. **安全**：多 provider 的 API Key 都在 server 配置中，需沿用现有 env 管理，不落入前端

## 后续步骤

1. → **阶段三**：SDD 文档生成（proposal → specs → design → tasks），change 名 `multi-model-runtime-switching`
2. → proposal / specs 各过 grill-me
3. → spec-hardener 审查
4. → writing-plans 实现计划
5. → 实现前门禁 + 风险路由 → TDD 实现
