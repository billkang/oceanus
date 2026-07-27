---
name: oceanus-docs-restructure
description: Oceanus 项目文档目录结构优化
---

# Oceanus 文档目录结构讨论

**日期：** 2026-07-27
**参与人：** 用户 + Claude

## 问题

Oceanus 项目的 `docs/` 目录结构存在以下问题：

1. **编号冲突**：`1-getting-started` 和 `1-requirements` 同时以 `1-` 开头
2. **空目录**：`1-requirements`、`5-operations` 为空目录
3. **冗余目录**：`3-api`、`4-ui` 内容非常精简（几百字节），不符合"项目级介绍、细节看代码"的理念
4. **文档宣贯**：INDEX.md 中引用了多个不存在的文件（`state-management.md`、`monitoring.md`、`CHANGELOG.md`）
5. **孤立文件**：`deployment.md` 散落在 docs 根目录，未纳入任何分类

## 讨论过程

1. 确认文档定位为"项目级介绍 + 模块关系"——细节看代码
2. 删除细节目录：`3-api`（api-reference.md 仅 339B）、`4-ui`（component-gallery.md 仅 915B）
3. 保留 essentials：新手入门、架构、运维
4. `references` 作为用户自定义区域
5. 重新编号使目录顺序连续

## 决策

- **删除的目录**：`1-requirements/`、`3-api/`、`4-ui/`、`6-contributing/`
- **重命名**：`5-operations/` → `3-operations/`，`7-references/` → `4-references/`
- **移动文件**：`docs/deployment.md` → `3-operations/deployment.md`
- **更新 INDEX.md**，移除失效链接，精简为四个板块
- **更新 overview.md**，移除已删除 API 文档的死链

## 最终结构

```
docs/
├── 1-getting-started/    # 快速启动、环境配置（框架自带）
├── 2-architecture/       # 架构总览、数据模型、ADR（框架自带）
├── 3-operations/         # 部署指南（框架自带）
├── 4-references/         # 🔧 用户自定义 — 规划、PPT、验证报告等
└── INDEX.md
```
