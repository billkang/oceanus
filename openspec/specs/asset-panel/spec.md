# asset-panel Specification

## Purpose

前端资产面板能力：Tide-discuss 完成后自动提取 PRD 存入 assets 表，支持查看、下载、复制资产内容，并在无资产时展示空状态。
## Requirements
### Requirement: PRD 自动提取

系统 SHALL 在 Tide-discuss 讨论完成后自动提取 PRD 内容存入 assets 表。

#### Scenario: 讨论完成自动提取

- **WHEN** Tide-discuss 工作流完成并产出 PRD
- **THEN** 系统自动将 PRD Markdown 存入 assets 表（type: prd），通过 SSE 通知前端

#### Scenario: 资产列表展示

- **WHEN** 前端收到"PRD 已生成"通知
- **THEN** 右侧资产面板自动刷新，展示资产列表

### Requirement: 资产查看与下载

系统 SHALL 支持查看完整 Markdown 内容、下载为 .md 文件、一键复制内容。

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

会话尚未产出任何资产时，面板 SHALL 展示空状态。

#### Scenario: 初始空状态

- **WHEN** 刚创建会话，尚未完成 Tide-discuss
- **THEN** 资产面板展示"暂无资产"提示

### Requirement: 资产访问权限

资产相关端点 SHALL 校验当前用户对资产的所有权，非所有者一律返回 404。所有权通过 `asset → session → username` 链路判定。

#### Scenario: 列表按会话过滤

- **WHEN** 当前用户请求某会话的资产列表（listBySession）
- **THEN** 服务端校验该会话属于当前用户（`session.username === 当前用户`，非所有者返回 404）
- **THEN** 仅返回该会话下当前用户可见的资产

#### Scenario: 查看/下载/复制资产

- **WHEN** 当前用户请求查看（getById）、下载（download）或复制（copy）某资产
- **THEN** 服务端按 `asset → session → username` 链路校验所有权（非所有者返回 404）

#### Scenario: 越权访问统一 404

- **WHEN** 请求涉及其他用户的会话及其资产
- **THEN** 服务端统一返回 404（不区分"不存在"与"无权限"）

