# 任务 018 — Claude Agent SDK 用户交互闭环验证

**Epic:** 集成与联调
**优先级:** P0
**关联需求:** FR-10

---

## 描述

这是 MVP 中技术风险最高的一个环节。需要验证 Claude Agent SDK 在 DeepSeek Provider 下，当工具需要用户确认时，是否能正确发出事件，以及前端选项 → 后端转发 → SDK 继续执行的完整闭环。

## 验证方案

### Phase 1：SDK 基础集成验证
1. 创建最小 Demo，初始化 Claude Agent SDK + DeepSeek Provider
2. 验证 SDK 能正常发出 `content_block` 事件
3. 验证 SSE 能正常推送事件到前端

### Phase 2：工具确认闭环验证
1. 编写一个简单的测试 Skill，包含需要用户确认的步骤
2. 验证 SDK 能否正确发出确认事件
3. 验证用户选择能否回传给 SDK 并继续执行

### Phase 3：Tide-discuss 适配验证
1. 加载真实的 Tide-discuss Skill
2. 验证 BMAD 流程中所有需要用户输入的场景
3. 验证多轮确认交互的连续性

## 验收标准

- [ ] Phase 1 通过：SDK 初始化 + 事件推送
- [ ] Phase 2 通过：确认事件发出 → 用户选择 → SDK 继续
- [ ] Phase 3 通过：Tide-discuss 完整流程可正常交互

## 技术要点

- 需先确认 Claude Agent SDK 的版本（锁定兼容 DeepSeek 的版本）
- SDK 的 `stream_event` 或 `onEvent` 回调接口需要查阅文档
- 用户确认可能对应 SDK 的 `tool_use` 事件中的特定字段
- 如 SDK 不原生支持自定义确认事件，考虑在 tide-discuss Skill 层面做适配
