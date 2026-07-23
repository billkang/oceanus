---
name: sweep-init
description: 初始化 E2E 测试项目骨架。创建目录结构、根据 setup 配置生成对应测试框架配置、读取 MCP 配置、设置多环境变量，标志项目可被 flow-create 和 flow-run 使用。
allowed-tools: Read, Write, Edit, Bash
deepstorm:
  tool: sweep
---

# Sweep Setup — E2E 测试项目初始化

初始化当前目录（或指定子目录）为 Sweep E2E 测试项目。根据 DeepStorm setup 阶段选择的 E2E 框架（如 Playwright），创建对应的项目骨架。

> **注意：** setup 是 flow-create 和 flow-run 的硬性前置条件。如果当前目录未初始化，其他 skill 会报错引导执行 `/sweep-init`。

---

## 使用方式

```bash
/sweep-init
```

在需要作为 E2E 测试项目的目录中执行。通常在一个空的或已有 git 仓库的目录中运行。

---

## 工作流

### 步骤 0：读取框架配置

在执行初始化前，先读取 `.deepstorm/settings.json` 中的 `sweep.e2eFramework` 配置，确定当前项目使用的 E2E 框架。

```bash
cat .deepstorm/settings.json 2>/dev/null | grep -o '"e2eFramework"[^,]*' | head -1 | cut -d'"' -f4
```

如果配置不存在或为空，使用默认值 `playwright` 并输出提示。

当前支持的框架：
- **playwright** — Microsoft Playwright（默认）

---

### 步骤 0A：选择生成位置

在执行初始化前，先询问用户的 E2E 测试项目类型，确定文件生成的目标目录。

> **注意：** TARGET_DIR 是后续所有文件操作的前缀，在整个初始化流程中使用。

#### 0A.1 询问项目类型

```
📂 请问你的 E2E 测试是哪种类型？

  a) 独立项目 → 生成在当前目录
  b) 与其他项目混放 → 生成到子目录
```

**如果选择 a（独立项目）：**
- 设置 TARGET_DIR 为当前目录（`.`）
- 继续到步骤 1

**如果选择 b（混放项目）：**
- 进一步询问子目录选择：

```
  请选择目标子目录：
  1) e2e/           👈 推荐
  2) tests/e2e/
  3) 自定义路径
```

- 如果选择 3（自定义），AI 询问用户输入路径
- 验证用户输入的路径：不能为空、不能是绝对路径、不能包含 `..`
- 设置 TARGET_DIR 为所选路径（如 `"e2e"`、`"tests/e2e"` 等）
- 如果子目录已存在且非空，输出警告并询问用户是否确认继续

#### 0A.2 记录 TARGET_DIR

`TARGET_DIR` 变量在后续所有步骤中使用。写入 `.deepstorm/settings.json` 中的 `sweep.e2eProjectPath` 字段将在步骤 8 中完成。

---

### 步骤 1：检查初始化状态

检查当前项目是否已初始化为 E2E 测试项目。从 `.deepstorm/settings.json` 读取 `sweep.e2eProjectPath` 判断。

#### 1.1 检查 settings.json

```bash
E2E_PATH=$(cat .deepstorm/settings.json 2>/dev/null | grep -o '"e2eProjectPath"[^,]*' | head -1 | cut -d'"' -f4)
```

#### 1.2 已初始化 → 退出

- **WHEN** `sweep.e2eProjectPath` 已设置
- **THEN** 提示"当前项目已初始化为 Sweep 测试项目。如需重新初始化，请删除 `sweep.e2eProjectPath` 配置后重试。"并退出

#### 1.3 未初始化 → 继续

- **WHEN** `sweep.e2eProjectPath` 未设置
- **THEN** 继续执行初始化流程

---

### 步骤 2+3：创建项目目录与配置文件

使用 `init-project.mjs` 一键创建目录结构并生成所有配置文件：

```bash
node packages/sweep/skills/sweep-init/scripts/init-project.mjs \
  --dir "$TARGET_DIR" \
  --framework "$(node scripts/env-manager.mjs --framework | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).framework || ''")"
```

脚本会自动：
- 创建 `flows/`、`flows/reports/`、`scripts/` 目录
- 生成 `package.json`（含框架对应依赖）、`tsconfig.json`、`playwright.config.ts`（仅 playwright）
- 不覆盖已有的 `topology.yaml`
- 执行 `npm install`

---

### 步骤 4：收集多环境配置信息

#### 4.1 交互式询问环境地址

逐项询问用户输入被测系统的环境地址：

1. 测试环境（test）baseURL
2. 预发布环境（staging）baseURL
3. 生产环境（prod）baseURL
4. 默认目标环境（test / staging / prod）

#### 4.2 写入 settings.json

将多环境配置写入 `.deepstorm/settings.json` 的 `sweep.environments` 字段。**不再生成 `.env` 文件。**

使用 Bash 和 `jq` 合并写入（或 AI 读取-修改-写回）：

```bash
# 先读取现有 settings.json
SETTINGS=$(cat .deepstorm/settings.json 2>/dev/null || echo "{}")

# 构造 environments 配置并写入
# （使用 jq 或 AI 逐字段修改）
```

写入后的 settings.json 结构示例：

```json
{
  "sweep": {
    "e2eFramework": "playwright",
    "environments": {
      "test": { "baseUrl": "http://localhost:3000" },
      "staging": { "baseUrl": "https://staging.example.com" },
      "prod": { "baseUrl": "https://prod.example.com" },
      "default": "test"
    }
  }
}
```

> **注意：** API Key 等敏感信息仍然放在 `.env` 文件（gitignored）中。此处仅迁移多环境 baseURL 配置。

---

### 步骤 5：创建 topology.yaml 初始模板

写入功能模块拓扑文件基础结构到 `{TARGET_DIR}/flows/topology.yaml`：

```yaml
# flows/topology.yaml
name: E2E 测试拓扑
version: 1

modules:
  - name: example
    description: 示例模块
    children:
      - name: feature1
        description: 功能 1
        features: []
```

**提示用户：** 请根据实际产品结构编辑 `flows/topology.yaml`，添加对应的功能模块。

---

### 步骤 6：创建 flow-selector.mjs

使用 Read 读取本 skill 目录下的 `scripts/flow-selector.mjs` 文件，用 Write 写入目标项目的 `{TARGET_DIR}/scripts/flow-selector.mjs`。

> **说明：** `flow-selector.mjs` 是基于 `@inquirer/checkbox` 的层级选择工具脚本（供 flow-run skill 调用）。
> 它与本 SKILL.md 同属一个 skill，作为 skill 的子文件分开维护，避免内联代码块导致的重复。

---

### 步骤 7：确认 E2E 框架 MCP 配置（从 `.mcp.json` 读取）

检查 `.mcp.json` 中是否存在对应框架的 MCP 服务配置。当框架为 `playwright` 时，检查 `deepstorm-playwright` 服务。

#### 检查 MCP 配置

```bash
cat .mcp.json 2>/dev/null | grep -c "deepstorm-playwright"
```

#### 7.1 MCP 已配置

- **WHEN** `.mcp.json` 中存在 `deepstorm-playwright`
- **THEN** 输出 "✅ Playwright MCP 已就绪（由 deepstorm setup 管理）"

#### 7.2 MCP 未配置

- **WHEN** `.mcp.json` 中不存在 `deepstorm-playwright`
- **THEN** 输出提示："⚠️ Playwright MCP 未配置。建议运行 `deepstorm setup` 并选择 Playwright MCP 服务以启用浏览器自动化。"
- **THEN** 不阻塞初始化流程，继续执行

> **注意：** Playwright MCP 配置由 CLI setup wizard 统一管理，不再由本 skill 单独配置。

---

### 步骤 8：完成初始化

#### 8.1 写入 e2eProjectPath 到 settings.json

```bash
node scripts/env-manager.mjs --set-e2e-path "$TARGET_DIR"
```

#### 8.2 输出完成信息

```
✅ Sweep E2E 测试项目初始化完成！

框架：{所选框架}
位置：{TARGET_DIR}

项目结构：
  {TARGET_DIR}/flows/          — 测试意图文档目录
  {TARGET_DIR}/flows/reports/  — 执行报告目录
  {TARGET_DIR}/scripts/        — 辅助脚本
  (框架配置文件)              — {框架名} 配置文件

下一步：
  1. 编辑 {TARGET_DIR}/flows/topology.yaml 添加你的功能模块
  2. 运行 /sweep-plan 创建测试意图文档
  3. 运行 /sweep-run 执行测试流程
```

---

## 检查清单

- [ ] 已读取框架配置（`deepstorm.sweep.e2eFramework`）
- [ ] 步骤 0A：已选择目标目录（`TARGET_DIR` 已确定）
- [ ] 步骤 1：检查通过（`e2eProjectPath` 未设置）
- [ ] 项目目录结构已创建（`{TARGET_DIR}/flows/`、`{TARGET_DIR}/flows/reports/`、`{TARGET_DIR}/scripts/`）
- [ ] package.json 已写入（含对应框架的依赖）
- [ ] 框架配置文件已生成（如 playwright.config.ts）
- [ ] tsconfig.json 已写入
- [ ] 用户已输入三个环境的 baseURL
- [ ] environments 已写入 `.deepstorm/settings.json` 的 `sweep.environments`
- [ ] topology.yaml 初始模板已创建
- [ ] flow-selector.mjs 已写入
- [ ] 已确认 MCP 配置状态（从 `.mcp.json` 读取）
- [ ] `sweep.e2eProjectPath` 已写入 `.deepstorm/settings.json`
- [ ] npm install 已在目标目录执行
