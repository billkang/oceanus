---
name: reef-gen-backend
description: 后端代码编写流程（NestJS + TypeScript + Prisma）。编写或生成后端代码时自动加载，编码规范详情引用 reef:reef-style-backend。
when_to_use: 用户要求编写或修改后端代码；创建新的后端文件；用户说"生成后端代码""写接口""加表"等
user-invocable: false
allowed-tools: Bash(git:*), Bash(pnpm:*)
deepstorm:
  tool: reef
  configKey: reef.backend.language
---

# 后端代码编写流程

编码规范详情（实体层次、数据访问、业务逻辑、API 模式、多租户红线、代码风格）请通过 Skill tool 加载 **`reef:reef-style-backend`** 获取。

## 工作流

### 1. 找参考实现

在动手之前，先在已有代码中找一个同类实现。优先搜索当前模块目录：

```bash
# 替换 <module> 为当前模块名
find server/src/ server/test/ -path "*/<module>/*" -type f

# 找最近修改的同类文件（使用 fork-point 避免全量历史）
FORK_POINT=$(git merge-base "$(git reflog --date=local | grep "checkout: moving from.* to $(git rev-parse --abbrev-ref HEAD)$" | head -1 | sed -n 's/.*from \([^ ]*\) to .*/\1/p' || echo main)" HEAD)
git diff "$FORK_POINT"..HEAD --diff-filter=M --name-only
```

**规则**：不凭空写新文件。先读一个真实存在的同类文件，理解模式后再动手。写新模块时参考已有模块的完整实现。

### 2. 🔴 加载编码规范（硬性门禁）

> **必须先通过 Skill tool 加载 `reef:reef-style-backend`，阅读 `quick-reference.md` 了解核心编码规范，并根据当前变更类型阅读对应的维度规范文件（如 `spring-boot.md`、`hibernate.md`、`fastapi-quick-reference.md`、`pytest-testing.md` 等）。完成后方可进入后续代码编写步骤。未加载 code-style 技能不得编写代码，否则视为违反工作流纪律。**

加载完成后，AI MUST 输出以下声明：

```
✅ [CODE-STYLE] 已加载后端编码规范（quick-reference + 必要维度规范），所有新增/修改代码将遵循项目编码规范。
```

涉及库/框架 API 用法时，使用 context7 获取最新文档：`resolve-library-id` → `query-docs`。

### 3. 编写代码

阅读本技能目录下的 `steps.md` 了解当前技术栈的编码步骤顺序和规范。编写过程中逐单元对照 `reef:reef-style-backend` 中对应章节检查。

**注释要求**：所有生成的后端代码必须包含有意义的注释（Javadoc / Docstring / 行内注释），说明代码的功能、参数含义和业务逻辑。缺少必要注释的代码视为未完成，不得提交。
**注释语言**：代码注释统一使用中文，专有名词/技术术语（如 REST、DTO、HTTP、JPA 等）保留英文。

### 4. 运行验证

写完后运行验证：

```bash
# 快速验证（秒级）
npx eslint build

# 最终验证（提交前）
npx eslint check
```

### 5. 🔴 提交前自检（后置检查）

重新加载 `reef:reef-style-backend` 技能，逐项对照所有规范要求检查本变更中的每处代码修改。**检查未通过不得提交。**
