---
name: reef-style-frontend
description: 前端编码规范（Angular 21 + TypeScript + Signal + PrimeNG + Tailwind CSS 4）。创建/修改前端代码时必须按本技能输出。
user-invocable: false
allowed-tools: Bash(git:*), Bash(pnpm:*)
model: opus
deepstorm:
  tool: reef
  configKey: reef.frontend.framework
---

# 前端编码规范

## ⚠️ 触发条件（必须遵守）

创建或修改任何前端文件时，必须通过 Skill tool 加载本技能，并按本技能中所有规范输出代码。对应技术栈：Angular 21 + TypeScript + Signal + PrimeNG + Tailwind CSS 4。

> **仅对本次新增/修改的代码应用规范，不格式化已有代码。** 已有的、本次未修改的代码行保持原样。

## 维度规范

### 框架规范

→ 参考 [Angular 前端速查](quick-reference.md)

### CSS 方案

→ 参考 [Tailwind CSS 规范](tailwind.md)

### UI 组件库

→ 参考 [PrimeNG 规范](primeng.md)

## 知识文件

以下文件位于本技能目录，安装时自动复制。内容按所选维度定制。

加载本技能时先用 `Read` 读取 `quick-reference.md` 了解核心规范，再按照上方「维度规范」中的链接选择对应文件加载（如 `primeng.md`、`vitest.md`），最后根据当前变更类型在 `examples/` 目录中选择示例文件：

| 文件                 | 说明                                                           |
| -------------------- | -------------------------------------------------------------- |
| `quick-reference.md` | **编码规范速查**。包含核心规则和约定                           |
| `{value}.md`         | **维度规范**（如 `primeng.md`、`tailwind.md`）。按上方链接加载 |
| `examples/{文件}`    | 按需加载示例文件（仅读与当前变更相关的）                       |

## 使用方式

- **创建/修改前端代码时**：Skill tool 自动加载（见触发条件）
- `reef:reef-gen-frontend` — 编写前端代码时自动加载
- `reef:reef-review-frontend` — 审查前端代码时自动加载
