---
name: reef-harden
description: 对 AI 生成的 spec、proposal、design、tasks 等 SDD 文档进行系统性加固。使用四道筛 + 反向 grill + Known Limitations 沉淀。当 AI 刚写完或用户想审查 spec/proposal/design/tasks 文档时触发，尤其当用户说"加固spec"、"按四道筛过"、"补不做什么"、"补known limitation" 或需要改进 SDD 文档质量时。
allowed-tools: Bash(git:*), Bash(find:*), Read, Edit, Write
deepstorm:
  tool: reef
---

# Spec Hardener

## 上下文约定

使用 `find-change-dir.mjs` 自动发现当前 change：

```bash
node packages/reef/skills/reef-harden/scripts/find-change-dir.mjs
```

输出 JSON。`noMatch: true` 时需让用户选择；有 `suggestion` 时使用推荐 change。

如需并列出 SDD 文档路径：
```bash
node packages/reef/skills/reef-harden/scripts/find-change-dir.mjs --files
```

## 快速开始

```
1. 读取当前 change 下所有 SDD 文档（含 design.md 的 Change Scope Matrix）
2. 按顺序过五道筛：硬数字 → 不做什么 → 验证方法 → 影响链完整性 → 反向 grill
3. 将发现直接编辑回文档
4. 将反向 grill 产出的关键风险沉淀为 Known Limitations
```

## 工作流

### Step 1: 加载文档

```bash
CHANGE_JSON=$(node packages/reef/skills/reef-harden/scripts/find-change-dir.mjs)
# CHANGE_JSON 中包含 path 和 files[]，files 为所有 SDD 文档路径
```

读取所有这些文档。目录结构通常为：

```
openspec/changes/<change>/
├── proposal.md
├── specs/
│   ├── 01-core-scenario.md
│   └── 02-error-scenario.md
├── design.md
└── tasks.md
```

### Step 2: 五道筛

按顺序过筛，每道筛产出可直接编辑到文档中的内容：

#### 第一道筛：特定数字

搜索文档中所有具体数字（5MB、3000、80%、100ms 等），逐一判断：
- 有引用来源（benchmark、SLA、Figma 等）→ 通过
- 无引用来源 → 标注 TBD 或在旁边加上 Rationale 说明理由
- 禁止让"看起来合理但无根据"的数字留在文档里

#### 第二道筛："不做什么"

检查是否存在 `## 不做什么` / `## Out of Scope` 段：
- 若不存在 → 必须新增
- 若存在但内容敷衍（< 5 条）→ 用反向提问扩充："这个功能在第一版里应该不做什么？"

至少应覆盖：
- 不支持的功能/控件/场景（明确列出）
- 第一版 scale 边界（并发、文件大小、批量操作等）
- 是 permanent out 还是 v2 做（标注）

#### 第三道筛：验证方法

检查所有验证要求，确保每一条可执行：
- "定期 review" → 不合格，追问为"谁、频率、用什么工具"
- "写测试" → 不合格，细化为"FormExportServiceTest：覆盖 X/Y/Z 场景"
- 每条验证应对应一个 CI 命令或具体测试步骤

#### 第四道筛：影响链完整性

读取 design.md 中的 Change Scope Matrix，遍历矩阵每一层的变更，检查 `specs/` 中是否有对应场景覆盖：

```
| Matrix 层 | 变更内容 | specs 覆盖 |
|-----------|---------|-----------|
| Entity 新增字段 | status | ✅ specs/cap1-spec.md 场景 4 |
| Controller 新增接口 | POST /users/{id}/approve | ❌ 缺少异常响应场景 |
| Migration 新增列 | status VARCHAR | ⚠️ 需要回滚场景 |
```

- ✅ 已覆盖 → 通过
- ❌ 缺失 → 标记不合格，要求补充对应场景
- ⚠️ 需人工确认 → 标记提示（如回滚、迁移数据完整性等跨层场景）

**为什么要放在第四道：** 在确认数字合理、边界明确、可验证之后，再从架构层面确认每层变更都有 spec 兜底。不满足此筛时不进入反向 grill，避免在不完整的基础上做无意义质疑。

#### 第五道筛：反向 Grill

以质疑者立场追问自己刚写的 spec：
"请你从质疑者的角度，给我列五个这份 spec 可能在三个月后让我后悔的地方。"

将产出中有价值的点作为 Known Limitations 或风险标注回文档。

### Step 3: 沉淀 Known Limitations

在 proposal.md 末尾添加 `## Known Limitations` 段，内容来源：
1. 第二步"不做什么"中标注的边界
2. 第四步反向 grill 中不可忽视的风险点
3. 已知但有意推迟的 trade-off

格式：每条限制包含**标题**（加粗）+ 解释原因（一行）。

### Step 4: 汇报

输出一张改动清单：按文档列修改了什么，新增了什么段。

## 注意事项

- 业务指标类数字（如 SLA 数值）若用户确认则无需修改
- 不要强行给所有数字标 TBD，需要对有根据的数字（如引用 Figma 的颜色值）放行
- 反向 grill 产出的五点中，选取可落地的 3-5 条写入文档，而非全量
- 所有编辑应保持原文档风格和格式一致
