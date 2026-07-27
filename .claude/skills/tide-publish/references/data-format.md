# 数据格式参考（发布相关）

本文件记录 tide-publish 使用的数据格式，主要是会话状态、publishChecklist 和 services 字段。

## 会话状态（发布阶段）

| 状态            | 含义                           | 何时设置            |
| --------------- | ------------------------------ | ------------------- |
| `prd_ready`     | PRD 已生成，待发布             | tide-discuss 完成时 |
| `published`     | 已发布到知识库                 | 4a 成功后           |
| `publish_error` | 发布过程中出错                 | 4a/4c 执行失败时    |
| `completed`     | 工单已创建（或全部跳过），终态 | 4c 成功或全部跳过时 |
| `superseded`    | 已废弃（放弃发布/变更需求）    | 用户选择放弃时      |

## publishChecklist 格式

记录发布流程中各步骤的完成状态，支持断点续传。

```json
{
  "publishChecklist": [
    {
      "step": "knowledge_base_push",
      "done": true,
      "note": "已推送到知识库"
    },
    {
      "step": "issue_task_split",
      "done": true,
      "note": "用户已确认 5 个任务"
    },
    {
      "step": "create_issues",
      "done": false,
      "total": 5,
      "created": 3,
      "failedItems": [
        {
          "title": "Story 4: Token 刷新优化",
          "fr": "FR-4",
          "priority": "P1",
          "acceptance": ["Token 过期后自动刷新", "刷新过程用户无感知"],
          "description": "用户登录后获取 Token，Token 过期前自动调用刷新接口"
        }
      ]
    }
  ]
}
```

**规则：**

- `done: true` + 无 `skipped` → 已完成
- `done: true` + `skipped: true` → 被跳过（无可用 MCP）
- `done: false` + 无 `failedItems` → 从未执行，从头开始
- `done: false` + 有 `failedItems` → 部分失败，仅重试失败项

## services 命名空间

记录发布过程中使用的外部服务信息和连接数据。

```json
{
  "services": {
    "capabilities": {
      "knowledge_base": {
        "available": true,
        "providers": [{ "id": "feishu-wiki", "label": "飞书知识库" }]
      },
      "issue_tracker": {
        "available": true,
        "providers": [{ "id": "jira", "label": "Jira" }]
      }
    },
    "knowledgeBase": {
      "provider": "feishu-wiki",
      "url": "https://feishu.cn/wiki/xxx"
    },
    "issueTracker": {
      "provider": "jira",
      "urls": ["https://jira.example.com/browse/PROJ-123", "https://jira.example.com/browse/PROJ-124"],
      "taskBreakdown": [
        {
          "title": "支持企业微信扫码登录",
          "fr": "FR-1",
          "priority": "P0",
          "acceptance": ["用户可通过企业微信扫码完成登录"],
          "description": "实现企业微信 OAuth 扫码登录流程"
        }
      ]
    }
  }
}
```

### 向后兼容旧字段

以下旧字段保留为向后兼容别名。新代码优先使用 `services` 命名空间，读取时降级：

| 旧字段              | 新字段                                | 降级规则                                           |
| ------------------- | ------------------------------------- | -------------------------------------------------- |
| `dingtalkUrl`       | `services.knowledgeBase.url`          | `services.knowledgeBase` 不存在时读取              |
| `jiraUrls`          | `services.issueTracker.urls`          | `services.issueTracker` 不存在时读取               |
| `jiraTaskBreakdown` | `services.issueTracker.taskBreakdown` | `services.issueTracker.taskBreakdown` 不存在时读取 |

**读写规则：** 写入 `services` 命名空间，不再写入旧字段。读取时优先 `services`，不存在时降级到旧字段。

## 失败条目格式（failedItems）

```json
{
  "title": "Story 标题",
  "fr": "FR-1",
  "priority": "P0",
  "acceptance": ["验收标准 1"],
  "description": "Issue 详细描述"
}
```
