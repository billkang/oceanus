---
name: reef-style-backend
description: 后端编码规范（NestJS + TypeScript + Prisma）。包含实体层次、DTO、Service/Controller/Repository 模式、MapStruct、多租户安全等完整规范。创建/修改后端代码时必须按本技能输出。
user-invocable: false
allowed-tools: Bash(git:*), Bash(pnpm:*)
deepstorm:
  tool: reef
  configKey: reef.backend.language
---

# 后端编码规范

## ⚠️ 触发条件（必须遵守）

创建或修改任何后端文件时，必须通过 Skill tool 加载本技能，并按本技能中所有规范输出代码。对应技术栈：NestJS + TypeScript + Prisma。

> **仅对本次新增/修改的代码应用规范，不格式化已有代码。** 已有的、本次未修改的代码行保持原样。

## 维度规范

### 语言/平台规范

→ 参考 [Node.js NestJS 后端速查](quick-reference.md)

## 知识文件

以下文件位于本技能目录，安装时自动复制。内容按所选维度定制。

加载本技能时先用 `Read` 读取 `quick-reference.md` 了解核心规范，再按照上方「维度规范」中的链接选择对应文件加载（如 `spring-boot.md`、`hibernate.md`），最后根据当前变更类型在 `examples/` 目录中选择示例文件：

| 文件                       | 说明                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `quick-reference.md`       | **编码规范速查**。包含核心规则和约定                                     |
| `{value}.md`               | **维度规范**（如 `spring-boot.md`、`hibernate.md`）。按上方链接加载      |
| `api-spec.md`              | **API 规范**。RESTful 命名、统一响应体、版本策略、OpenAPI                |
| `jackson-polymorphism.md`  | **DTO 多态序列化规范**。Jackson `@JsonTypeInfo` + TS Discriminated Union |
| `dependency-management.md` | **依赖管理规范**。Version Catalog、版本一致性、CVE                       |
| `exception-handling.md`    | **异常处理深度规范**。异常层次、错误码、全局处理                         |
| `security-redlines.md`     | **安全红线**。P0/P1 安全规则及代码示例                                   |
| `examples/{文件}`          | 按需加载示例文件（仅读与当前变更相关的）                                 |

## 使用方式

- **创建/修改后端代码时**：Skill tool 自动加载（见触发条件）
- `reef:reef-gen-backend` — 编写后端代码时自动加载
- `reef:reef-review-backend` — 审查后端代码时自动加载
