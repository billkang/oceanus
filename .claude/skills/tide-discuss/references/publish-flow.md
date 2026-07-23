# 发布流程（Step 4）

PRD 生成后（`status: prd_ready`），分三步完成发布流程。每步根据运行时 MCP 能力映射动态决定是否执行或跳过。

## MCP 能力发现

进入 Step 4 时，AI 先读取 `.deepstorm/settings.json` → `mcpCapabilities` 确定可用的 provider。

能力映射结构示例（安装时渲染）：
```json
{
  "knowledge_base": {
    "available": true,
    "providers": [{ "id": "feishu-wiki", "label": "飞书知识库" }]
  },
  "issue_tracker": {
    "available": false,
    "providers": []
  }
}
```

### 可用性判定规则

- `knowledge_base.available = true` → 4a 可执行
- `issue_tracker.available = true` → 4b+4c 可执行
- providers 数组长度 > 1 → 在该步骤入口询问用户选择

### 引用 MCP skill 指南

调用某 provider 的 MCP 工具前，AI 必须读取对应的 skill 指南了解工具调用方式。skill 路径规则为 `.claude/skills/deepstorm-mcp-{provider-id}-write/SKILL.md`（如 `feishu-wiki` → `deepstorm-mcp-feishu-wiki-write`、`jira` → `deepstorm-mcp-jira-write`），按指南执行操作。

---

## 发布进度跟踪

每一步的完成状态记录在 session JSON 的 `publishChecklist` 字段中，支持断点续传：

```json
{
  "publishChecklist": [
    {"step": "knowledge_base_push", "done": true, "note": "已推送到知识库"},
    {"step": "issue_task_split", "done": true, "note": "用户已确认 5 个任务"},
    {"step": "create_issues", "done": false, "total": 5, "created": 3,
     "failedItems": [
       {"title": "Story 4: Token 刷新优化", "fr": "FR-4", "priority": "P1",
        "acceptance": ["Token 过期后自动刷新", "刷新过程用户无感知"],
        "description": "用户登录后获取 Token，Token 过期前自动调用刷新接口"},
       {"title": "Story 5: 多设备登录管理", "fr": "FR-5", "priority": "P2",
        "acceptance": ["同一账号最多 3 台设备同时在线", "超出时提示用户"],
        "description": "用户可在多台设备上登录同一账号，系统管理设备会话数"}
     ]}
  ]
}
```

**规则：**
- `done: true` + 无 `skipped` → 该步已完成，下次恢复时直接跳过
- `done: true` + `skipped: true` → 该步被跳过（无可用 MCP 服务）。恢复时**跳过该步**，不重新检查 MCP 可用性
- `done: false` + 无 `failedItems` → 该步从未执行过，从头开始
- `done: false` + 有 `failedItems` → 部分失败，仅重试 `failedItems` 中的条目
- 每次恢复时 AI 查看 `publishChecklist`，跳过已完成步骤，只处理失败项或未执行项

---

## 4a. 知识库推送

按能力映射可用性和 provider 数量动态执行：

### 场景 A：单知识库可用（自动推送）

1. **检查 PRD 文件存在性：** 读取 `tide-data/prds/{sessionId}-prd.md`。如果文件不存在，按优先级恢复：JSON 快照 → session steps 记录 → 重新生成 Markdown（详见 SKILL.md Step 3「异常处理」）
2. 根据 `services.knowledgeBase.provider`（或 `deepstorm.mcpCapabilities.knowledge_base.providers[0].id`）确定 provider，读取 `.claude/skills/deepstorm-mcp-{provider-id}-write/SKILL.md` 了解工具调用方式
3. 使用该 MCP 推送 PRD Markdown 到知识库
4. 成功后：
   - 保存 `services.knowledgeBase` → `{provider: "{provider-id}", url: "..."}`
   - `publishChecklist[0]` → `{step:"knowledge_base_push", done:true}`
   - `status` → `published`
5. 告知用户 PRD 已发布到知识库

### 场景 B：多知识库可用（用户选择）

在 4a 入口展示可用列表让用户选择：
```
检测到多个知识库服务：
1. {provider1.label} ({provider1.id})
2. {provider2.label} ({provider2.id})
请选择本次推送使用的知识库：
```
用户选择后，按所选 provider 的 skill 指南执行推送。选择结果持久化到 `services.knowledgeBase.provider`。

### 场景 C：无可用知识库（跳过）

1. `publishChecklist[0]` → `{step:"knowledge_base_push", done:true, skipped:true, note:"无可用知识库服务"}`
2. `status` → `published`
3. 告知用户"未检测到知识库服务，跳过 PRD 推送"

### 场景 D：推送失败

`publishChecklist[0].done = false`，`status` 改为 `publish_error`，提示用户错误信息，提供重试或放弃发布选项。

---

## 4b. 任务拆分

### 有可用工单系统时

1. 读取当前 PRD 的 Markdown / JSON 快照
2. 将 PRD 内容拆解为可落地的工作项：
   - **Epic：** `{featureId} — {brief}`（父级，包含完整背景和目标）
   - **Story：** 每个 FR / 用户故事对应一个 Story，含验收标准
   - **Task：** 较大的 Story 可拆成子 Task
   - **优先级：** 根据 PRD 中的优先级排序标注
3. 展示完整任务清单给用户确认，格式示例：
   ```
   📋 任务清单 — {featureId}

   Epic: {featureId} — {brief}
   ├─ Story 1: {title1}（FR-1）
   │  ├ 验收标准: {ac}
   │  └ 优先级: P0
   └─ Story 2: {title2}（FR-2）
      ├ 验收标准: {ac}
      └ 优先级: P1
   ```
4. **让用户确认或调整**任务清单（增删合并、调整优先级）
5. **用户确认后：** 将确认后的完整任务清单保存到 session JSON 的 `services.issueTracker.taskBreakdown` 字段（向后兼容：降级到旧字段 `jiraTaskBreakdown`）。`publishChecklist[1].done = true`，进入 4c
6. **用户中止：** 如果用户不想继续确认（"先这样"、"后面再说"），保持 `published` 状态，`publishChecklist[1].done = false`。提示用户可以随时回到此会话继续确认

### 多工单系统可用时（额外步骤）

在 4b 入口询问用户选择：
```
检测到多个工单系统：
1. {provider1.label} ({provider1.id})
2. {provider2.label} ({provider2.id})
本次使用哪个？
```
选择结果持久化到 `services.issueTracker.provider`，同一 session 内后续 4c 和恢复时直接读取，不再重新询问。

### 无可用工单系统时（跳过 4b + 4c）

- `publishChecklist[1]` → `{step:"issue_task_split", done:true, skipped:true, note:"无可用工单系统"}`
- `publishChecklist[2]` → `{step:"create_issues", done:true, skipped:true, note:"无可用工单系统"}`
- `status` → `completed`
- 告知用户"未检测到工单系统，跳过任务拆分和 Issue 创建"
- 自动归档

---

## 4c. 创建工单

### 正常创建

1. 优先从 session JSON 的 `services.issueTracker.taskBreakdown` 读取任务清单（向后兼容：降级到旧字段 `jiraTaskBreakdown`）。如不存在则从 PRD 重新生成
2. 根据 `services.issueTracker.provider`（或 `deepstorm.mcpCapabilities.issue_tracker.providers[0].id`）确定 provider，读取 `.claude/skills/deepstorm-mcp-{provider-id}-write/SKILL.md` 了解工具调用方式
3. 逐条创建 Issue

### 失败处理

- **部分失败：** 成功 URL 加入 `services.issueTracker.urls`（自动去重），`publishChecklist[2]` 记录 `{done: false, total: N, created: M, failedItems: [...]}`。`status` → `publish_error`。下次恢复时从 `taskBreakdown` 重建上下文，仅重试失败项
- **全部失败：** `publishChecklist[2]` 记录全部条目为 `failedItems`。`status` → `publish_error`。提示用户检查 MCP 连接
- **全部成功：** `publishChecklist[2].done = true`，移除 `failedItems`（避免残留过时数据），`total` 和 `created` 更新为成功总数。`status` → `completed`。自动归档

### 恢复路径

恢复 `published` 或 `publish_error` 状态的 session 时，AI 检查 `publishChecklist` 中的 `skipped` 标记，跳过已被跳过的步骤。已完成的步骤不重复执行。
