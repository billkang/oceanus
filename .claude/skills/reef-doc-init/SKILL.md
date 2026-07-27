---
name: reef-doc-init
description: Use when creating a new project, or when an existing project lacks a standardized docs/ directory structure and needs one initialized with INDEX.md, ADR templates, and C4 architecture diagram placeholders.
deepstorm:
  tool: reef
---

# 文档目录初始化

初始化标准化的 `docs/` 目录结构，包含索引文件、ADR 模板和 C4 架构图占位。

## 触发方式

| 方式        | 说明                       |
| ----------- | -------------------------- |
| `/doc-init` | 手动调用，初始化 docs 目录 |

## 工作流

### 1. 检查文档状态

确认当前项目是否已有 docs 目录：

```bash
ls docs/ 2>/dev/null || echo "docs 目录不存在"
```

如果 docs 目录已存在且有 INDEX.md，提示用户并退出。

### 2. 初始化 docs 目录

调用 CLI 的 `initDocsDir()` 创建标准目录结构：

```
docs/
├── INDEX.md
├── 1-getting-started/
├── 2-architecture/
│   ├── overview.md
│   ├── data-model.md
│   ├── decisions/ADR-000-template.md
│   └── diagrams/
├── 3-api/
├── 4-ui/
├── 5-operations/
└── 6-contributing/
```

### 3. 关联 context.md

检查 `.deepstorm/context.md`，确认已有文档索引链接：

```
📖 详细文档见 docs/INDEX.md
📐 架构设计见 docs/2-architecture/overview.md
```

如缺失则自动追加。

### 4. 检查 CLAUDE.md

执行 `initClaudeMd()` 的检测逻辑，扫描 CLAUDE.md 中是否有系统介绍段落可以迁移到 `docs/2-architecture/overview.md`，输出迁移建议清单。
