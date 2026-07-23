# 任务 008 — Asset Module — PRD 提取与存储 API

**Epic:** 后端 API 开发
**优先级:** P0
**关联需求:** FR-8

---

## 描述

当 Tide-discuss 工作流完成并生成 PRD 后，自动将 PRD 提取为结构化资产存储到数据库中，供前端资产面板展示。同时支持记录关联的 Jira 任务等资产类型。

**架构说明：** assets 表是数据库中唯一存储完整内容的表（PRD Markdown / 任务描述），与会话消息的存储方式（SDK JSONL）不同。

## Asset 类型

| type | 说明 | 内容格式 |
|------|------|----------|
| `prd` | PRD 文档 | Markdown |
| `jira_task` | Jira 任务 | JSON（任务摘要+链接） |
| ... | 预留扩展 | — |

## API 接口

### GET /api/sessions/:id/assets
获取某个会话的所有资产列表。
```json
{
  "assets": [
    {"id": "uuid", "type": "prd", "title": "PRD-项目名称", "createdAt": "..."},
    {"id": "uuid", "type": "jira_task", "title": "Jira-任务名", "createdAt": "..."}
  ]
}
```

### GET /api/assets/:id
获取单个资产详情（含完整 Markdown / JSON 内容）。

### GET /api/assets/:id/download
下载资产为 Markdown 文件（Content-Disposition: attachment）。
- PRD 类型：下载 .md 文件
- jira_task 类型：下载 .json 文件

### POST /api/assets
创建资产（用于 Agent Module 自动提交 PRD，或后续任务拆分时记录 Jira 关联）。

## 资产提取逻辑

Agent Module 中的 Tide-discuss 完成后，自动触发资产提取：

1. 检测讨论结果中是否包含 PRD 内容
2. 将 PRD 内容解析为结构化数据
3. 存入 `assets` 表（type: prd）
4. 通过 SSE 通知前端"PRD 已生成"
5. Issue/Task 拆分后，将拆分结果存入 assets（type: jira_task）
6. 前端自动刷新资产面板，展示 PRD + 任务列表

## 验收标准

- [ ] Tide-discuss 完成后自动提取 PRD 到 assets 表
- [ ] 资产列表 API 返回该会话的所有资产（含 PRD 和 jira_task）
- [ ] 完整 Markdown 内容可查看
- [ ] 支持下载为 `.md` / `.json` 文件
- [ ] 支持一键复制内容
- [ ] jira_task 类型资产的 CRUD

## 技术要点

- 资产类型枚举：`prd`、`jira_task`。预留扩展
- 资产面板初始为空，讨论完成后自动刷新
- 删除会话时级联清理本表数据（由 Session Module 的 DELETE 端点触发）
