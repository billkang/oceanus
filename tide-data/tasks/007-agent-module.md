# 任务 007 — Agent Module — Claude Agent SDK + DeepSeek + Tide-discuss 集成

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-7, FR-9, FR-10

---

## 描述

核心 Agent 模块，封装 Claude Agent SDK（TypeScript），配置 DeepSeek / 国产模型作为 Provider，加载 Tide-discuss 工作流，实现完整的 AI 需求讨论能力。

## 技术选型

| 项 | 决定 | 说明 |
|----|------|------|
| SDK 语言 | **TypeScript** | NestJS 原生集成，团队下个项目再切 TS |
| SDK 版本 | **待确认** | 对应 Python v0.1.62（2026年1月版）的 TS 版本，新版 tool-calling API 改版不兼容国产模型 |
| 国产模型 | **环境变量覆盖** | 通过 `ANTHROPIC_*` 系列 env 指向国产 API |
| 密钥管理 | **`.env` 文件** | 项目根目录，不提交到 git |

### SDK 版本说明

Claude Agent SDK v0.1.62（Python）之前版本支持通过环境变量替换为国产模型。新版 SDK tool-calling API 接口变更，使用国产模型会报 `400 bad request`。**TS 版本号需要实际确认**——查看 npm 上对应 2026 年 1 月左右的版本。

### 国内模型配置方式（`.env` 文件）

```env
# Claude Agent SDK 环境变量 — 覆盖为国内模型
ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
ANTHROPIC_MODEL=kimi-k2.6
ANTHROPIC_SMALL_FAST_MODEL=kimi-k2.6
ANTHROPIC_API_KEY=your_kimi_api_key_here
```

SDK 通过 `process.env.ANTHROPIC_BASE_URL` 等环境变量发现 API 地址，无需修改 SDK 源码。支持 Kimi、MiniMax 等支持 Anthropic API 格式的国产模型。

### Demo 测试

```typescript
import 'dotenv/config';
import { query } from 'claude-agent-sdk';

async function main() {
  for await (const message of query({ prompt: "2+2=?" })) {
    console.log(message);
  }
}

main().catch(console.error);
```

## 功能要点

1. **SDK 初始化** — 创建 Agent 实例，配置国产模型 API（通过环境变量 / 显式传参）
2. **Skill 加载** — 加载 Tide-discuss 的 BMAD 工作流作为 Skill
3. **会话管理** — 每个用户会话对应一个 Agent 会话，SDK JSONL 自动管理消息持久化
4. **事件转发** — 监听 SDK 内部事件，转发给 Chat Module 的 SSE 推送
5. **交互处理** — 接收用户的选择/输入，传递给 Agent 继续执行
6. **中断处理** — 支持用户主动中断当前响应

## 事件映射

| SDK 事件 | SSE 事件 | 前端表现 |
|----------|----------|----------|
| content_block_start (text) | message_start | 开始渲染文本块 |
| content_block_delta (text_delta) | message_delta | 追加流式文本 |
| content_block_start (tool_use) | tool_in_progress | 显示「正在分析需求...」 |
| tool_confirm | tool_options | 展示选项按钮 |
| content_block_stop | message_done | 当前块完成 |
| message_stop | message_complete | 整条消息完成 |
| error | error | 错误提示 |

## API 接口

### POST /api/sessions/:id/agent/stream
发送消息并触发的 Agent 处理，通过 SSE 返回结果。

### POST /api/sessions/:id/agent/confirm
用户对 Agent 确认请求的响应。
**请求体:**
```json
{
  "option": "A方案" // 或自定义文本
}
```

### POST /api/sessions/:id/agent/cancel
中断当前 Agent 响应。

## 验收标准

- [ ] Agent 能成功连接到国产模型 API 并返回响应
- [ ] Tide-discuss 工作流可正常启动
- [ ] SDK 内部事件正确映射为 SSE 事件
- [ ] 用户确认交互可正常往返（SDK → 前端选项 → 用户选择 → SDK）
- [ ] 中断可正常停止 Agent 响应
- [ ] `.env` 文件配置正确，`ANTHROPIC_*` 环境变量生效

## 技术要点

- Claude Agent SDK **需锁定特定版本**，TS 版本号对应 Python v0.1.62，实施阶段确认
- `.env` 文件不提交到 git（需配置 `.gitignore`）
- 每个会话维护独立的 Agent 实例，避免上下文混淆
- Agent 的 tool_use 循环由 SDK 管理，Oceanus 只负责事件转发
- 国产模型覆盖方式：通过 `dotenv` 加载 `.env` 中 `ANTHROPIC_*` 变量
