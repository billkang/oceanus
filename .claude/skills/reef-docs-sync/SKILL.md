---
name: reef-docs-sync
description: Use when code has changed in the project and documentation may be out of sync — before committing changes, or anytime the user asks "what docs need updating?" Detects modified files, matches them to documentation by mapping rules, and reports which docs need attention.
deepstorm:
  tool: reef
---

# 文档同步检测

检测当前变更涉及的代码文件，按映射规则匹配对应的文档，输出同步报告。

## 触发方式

| 方式                 | 说明                            |
| -------------------- | ------------------------------- |
| `/docs-sync`         | 手动调用，立即执行同步检测      |
| PreCommit hook       | commit 前自动检测（如果已配置） |
| reef-commit Step 6.8 | 集成到 reef-commit 流程中       |

## 工作流

### 1. 检测变更

```bash
git diff --name-status
```

获取当前工作区的未提交变更列表（新增 A / 修改 M / 删除 D / 重命名 R）。

无变更时提示用户并退出。

### 2. 匹配文档

按优先级顺序匹配变更文件对应的文档：

**a) 配置映射：** 读取 `.deepstorm/settings.json` 中 `docs-sync.mappings` 配置。每项包含 glob pattern 和对应文档路径列表。

**b) 默认规则兜底**（以下为内置默认匹配）：

| 文件模式                                  | 对应文档                            |
| ----------------------------------------- | ----------------------------------- |
| `**/*.controller.ts`                      | `docs/3-api/api-reference.md`       |
| `**/*.service.ts`                         | `docs/2-architecture/overview.md`   |
| `**/*.module.ts`                          | `docs/2-architecture/overview.md`   |
| `**/prisma/schema.prisma`                 | `docs/2-architecture/data-model.md` |
| `**/*.component.ts`                       | `docs/4-ui/component-guide.md`      |
| `**/Dockerfile` / `**/docker-compose.yml` | `docs/5-operations/deployment.md`   |
| `**/openapi.yaml` / `**/openapi.json`     | `docs/3-api/api-reference.md`       |

未匹配的文件标记为"无对应文档"。

### 3. 输出报告

| 变更文件                      | 对应文档                            | 变更类型 | 建议操作      | 状态 |
| ----------------------------- | ----------------------------------- | -------- | ------------- | ---- |
| `src/user/user.controller.ts` | `docs/3-api/api-reference.md`       | M        | 更新 API 描述 | ⚠️   |
| `prisma/schema.prisma`        | `docs/2-architecture/data-model.md` | M        | 更新数据模型  | ⚠️   |

### 4. AI 自动起草

根据变更文件的内容和期望的文档格式，自动生成更新后的文档内容，展示给用户预览。

- 用户确认 → 写入文档文件
- 用户拒绝 → 不修改

### 5. docs-sync 映射规则配置

在 `.deepstorm/settings.json` 中自定义映射规则：

```json
{
  "docs-sync": {
    "mappings": [
      { "pattern": "src/**/*.controller.ts", "docs": ["3-api/api-reference.md"] },
      { "pattern": "prisma/**", "docs": ["2-architecture/data-model.md"] }
    ]
  }
}
```

配置为空或不匹配时，默认规则自动兜底。
