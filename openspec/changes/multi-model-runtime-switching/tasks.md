# Tasks: 多模型注册与运行时切换

## 1. 模型注册表基础设施（后端）

- [ ] 1.1 新增 `yaml` 依赖到 `server/package.json`
- [ ] 1.2 新增 `server/config/models.yaml` + `models.example.yaml`（`default: deepseek`；deepseek 含 `keyPool: true`，kimi 含 `apiKeyEnv: KIMI_API_KEY`）
- [ ] 1.3 新增 `server/src/common/model-registry/` 模块（`model-registry.types.ts` + `model-registry.service.ts` + `model-registry.module.ts`）
- [ ] 1.4 实现注册表加载与校验：`onModuleInit` 读 yaml、必填字段校验、`default` provider 解析（缺省回退第一个并 WARN）、不可用 provider 判定（apiKeyEnv 缺失 / keyPool 池空）
- [ ] 1.5 实现对外接口：`isAvailable()`（注册表有效 且 默认 provider 可用）、`resolveProvider(model?)`（未知/不可用 → `BadRequestException`，信息含可用列表）、`listModels()`（`{ name, displayName, default }[]`）
- [ ] 1.6 `model-registry.service.spec.ts`：正常加载 / 文件缺失 / 配置非法 / 默认缺失 / apiKeyEnv 缺失 / keyPool 池空 / 默认 provider Key 缺失 → AI 整体不可用

## 2. AgentService 重构（后端）

- [ ] 2.1 `agent.service.ts` 注入 `ModelRegistryService`，重构 `available` 语义（constructor 不再读 `ANTHROPIC_API_KEY`，`isAvailable()` 委托 registry）
- [ ] 2.2 `sendMessage(content, { resume?, model? })` 调用 `registry.resolveProvider(model)` 解析 provider
- [ ] 2.3 query options 用 `provider.modelId` 替换硬编码 `model: 'claude-sonnet-5'`，新增 `env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY, ANTHROPIC_SMALL_FAST_MODEL }` 逐调用注入
- [ ] 2.4 删除 `process.env.ANTHROPIC_API_KEY` 全局突变/恢复逻辑；错误路径 `keyPool.markFailure` 仅对 `keyPool: true` 来源的 provider 生效
- [ ] 2.5 `agent.service.spec.ts`：默认 provider / 指定 kimi / 未知 model 抛错 / env 注入内容 / available=false 时抛 "AI 服务未配置"

## 3. Chat API 透传（后端）

- [ ] 3.1 `ChatRequestDto` 新增可选 `model` 字段（`@IsOptional() @IsString()`）
- [ ] 3.2 `chat.controller.ts` message / confirm 分支将 `dto.model` 传入 `sendAndStream` / `confirmAndStream` options
- [ ] 3.3 `chat.service.ts` `SendStreamOptions` / `ConfirmStreamOptions` 新增 `model?`，`sendAndStream` 透传至 `sendMessage`，`confirmAndStream` 透传 model（不漂移回默认）
- [ ] 3.4 `chat.controller.ts` 新增 `GET /models`（同 JWT 守卫），返回 `registry.listModels()`
- [ ] 3.5 `chat.controller.spec.ts` / `chat.service.spec.ts`：model 透传、`GET /models` 返回形状、未知 model 400

## 4. KeyPool 调整（后端）

- [ ] 4.1 `key-pool.service.ts` `loadKeysFromEnv` 移除 `ANTHROPIC_API_KEY` 兜底加载
- [ ] 4.2 `key-pool.service.spec.ts` 适配：仅 `LLM_API_KEY_N` 加载；无 `LLM_API_KEY_N` 且仅有 `ANTHROPIC_API_KEY` 时池为空

## 5. Langfuse 模型名可观测性（后端）

- [ ] 5.1 `langfuse.service.ts` `createTrace(sdkSessionId, projectId?, model?)` 增加可选 `model` 参数，作为 tag `model:<逻辑名>` 写入 trace
- [ ] 5.2 `agent.service.ts` `buildLangfuseHooks` 的 `SessionStart` hook 闭包捕获本次已解析 provider 逻辑名，传入 `createTrace`
- [ ] 5.3 `langfuse.service.spec.ts` 适配 `createTrace` 签名

## 6. 前端

- [ ] 6.1 `client/src/app/chat/chat.service.ts` 新增 `ModelInfo` 类型与 `getModels()`（GET `/api/v1/models`）
- [ ] 6.2 `client/src/app/chat/chat.service.ts` `sendMessage` 请求体新增 `model`；confirm 请求体新增 `model`
- [ ] 6.3 `chat.component.ts` 初始化拉取模型列表；`models.length > 1` 时渲染选择器（默认选中 `default: true`）；选中模型随 message / confirm 发送
- [ ] 6.4 `chat.component.html` 输入区上方新增 PrimeNG `p-dropdown` 模型选择器
- [ ] 6.5 `chat.service.spec.ts` / `chat.component.spec.ts` 适配：getModels 调用、model 参数透传、单模型隐藏选择器

## 7. 配置与环境迁移

- [ ] 7.1 `server/.env.example` 补充迁移说明：`ANTHROPIC_*` → `models.yaml` + per-provider Key（deepseek 沿用 `LLM_API_KEY_N` / kimi 新增 `KIMI_API_KEY`）
- [ ] 7.2 `server/.env` 本地新增 `KIMI_API_KEY` 占位
- [ ] 7.3 提交 `server/config/models.example.yaml` 模板（含注释）

## 8. 文档同步

- [ ] 8.1 `docs/1-getting-started/` 更新 env 迁移说明（`ANTHROPIC_*` 废弃，改 `models.yaml`）
- [ ] 8.2 `docs/3-api/api-reference.md` 更新 `POST /chat` 新增 `model` 字段 + 新增 `GET /models` 端点
- [ ] 8.3 新增 `docs/2-architecture/decisions/ADR-013-multi-model-runtime-switching.md`（记录 D1–D9 决策）
- [ ] 8.4 `.deepstorm/context.md` 更新 AI 模型条目（多模型注册）
