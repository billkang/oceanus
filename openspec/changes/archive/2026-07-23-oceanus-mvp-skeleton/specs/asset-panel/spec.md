## ADDED Requirements

### Requirement: PRD 自动提取
Tide-discuss 讨论完成后，自动提取 PRD 内容存入 assets 表。

#### Scenario: 讨论完成自动提取
- **WHEN** Tide-discuss 工作流完成并产出 PRD
- **THEN** 系统自动将 PRD Markdown 存入 assets 表（type: prd），通过 SSE 通知前端

#### Scenario: 资产列表展示
- **WHEN** 前端收到"PRD 已生成"通知
- **THEN** 右侧资产面板自动刷新，展示资产列表

### Requirement: 资产查看与下载
支持查看完整 Markdown 内容、下载为 .md 文件、一键复制内容。

#### Scenario: 查看资产内容
- **WHEN** 用户点击资产列表中的某个条目
- **THEN** 右侧面板展示完整内容（PRD 的 Markdown 渲染）

#### Scenario: 下载 Markdown
- **WHEN** 用户点击下载按钮
- **THEN** 浏览器下载 `.md` 文件（Content-Disposition: attachment）

#### Scenario: 复制内容
- **WHEN** 用户点击复制按钮
- **THEN** 资产内容复制到剪贴板

### Requirement: 空资产状态
会话尚未产出任何资产时，面板展示空状态。

#### Scenario: 初始空状态
- **WHEN** 刚创建会话，尚未完成 Tide-discuss
- **THEN** 资产面板展示"暂无资产"提示
