# Spec Hardener — 实践案例

以下案例来自 `form-excel-import-export` change 的实际加固过程。

## 案例：proposal.md — 补"不做什么"

### 加固前

proposal.md 的 Scope 段列出了 21 条要做的功能，但没有一条"不做什么"。

### 加固后

在 Scope 和 Impact 之间新增：

```markdown
## 不做什么
- 仅支持 Scope 中列出的控件类型（TextControl、NumberControl、DateTimeControl、
  ChoiceControl、ObjectControl），其余控件均不在本版本支持范围内
- 不支持批量导入（不支持一次上传多个 Excel 文件）
- 不支持并发导入（不处理多个用户同时导入同一表单的并发控制）
- 不支持超大文件处理（不实现分片上传或流式解析）
- 不支持多 Sheet 导入/导出（仅单 Sheet 可见数据 + 单 Sheet 隐藏元数据）
- 仅支持使用系统导出的模板进行导入（不接受用户自定义格式的 Excel）
- 仅支持新增数据（不支持通过 Excel 更新已有 FormResponse）
- ObjectControl 仅支持单层数据关联（不支持嵌套对象）
```

关键动作：反向提问用户"第一版应该不做什么"，将用户回答整理为结构化清单。

---

## 案例：spec.md — 补 Known Limitations

### 加固后

spec.md 末尾新增：

```markdown
## Known Limitations
本版本存在以下已知约束：

- **仅支持新增**：导入操作仅创建新的 FormResponse，不支持通过
  Excel 更新已有数据。如需对已有数据进行批量修改，需等待后续版本。
- **ObjectControl 仅单层**：ObjectControl 的数据关联值仅支持一层
  对象引用，不支持嵌套的关联对象结构。
- **仅接受系统模板**：导入功能仅接受通过本系统导出接口生成的
  Excel 模板填写后上传。用户自行构造的 Excel 将直接拒绝。
- **单文件串行处理**：每次导入仅支持一个 Excel 文件，不提供并发导入
  或流式逐行写入的能力。
- **固定限制不可配置**：5MB 文件上限、3000 行上限、200 列上限为
  硬编码限制，当前版本不提供管理员可配置的入口。
```

来源：反向 grill（"三个月后可能在哪五处后悔"）+ "不做什么"段。

---

## 案例：tasks.md — 细化验证

### 加固前

```markdown
- [x] 7.1 `FormExportServiceTest`：测试 Excel 生成逻辑（表头必填标记、
  填写说明行、下拉验证、隐藏 Sheet、Sheet 保护）
```

### 加固后

```markdown
- [x] 7.1 `FormExportServiceTest`：覆盖 TextControl / NumberControl /
  DateTimeControl / ChoiceControl（PredefinedOptionsSource + DatasetOptionsSource）
  / ObjectControl 五种控件导出；验证标题行必填标记 *、填写说明行、_meta Sheet
  的 revisionId 与 key 顺序、Sheet VERY_HIDDEN + 保护、白名单过滤、空字段报错
```

关键动作：将"测试 X"的许愿式描述替换为场景覆盖清单。

---

## 案例：数字处理策略

加固过程中发现的数字：

| 数字 | 处理方式 | 理由 |
|------|---------|------|
| 5MB / 3000行 / 200列 | **不修改** | 业务指标，用户确认 |
| #3B82F6 / #22C55E 等颜色 | **不修改** | 有引用来源（Figma） |
| w-225（对话框宽度） | **不修改** | 设计稿尺寸，可追溯 |
| application.properties vs .yaml | **修正** | 项目实际使用 yaml，文档写错 |
