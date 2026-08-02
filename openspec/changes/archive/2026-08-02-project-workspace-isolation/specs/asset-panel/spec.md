# asset-panel Specification

## Purpose

资产面板能力变更：PRD 自动提取后除写入 assets 表外，落盘会话目录产出物，并触发 LLM 语义合并归档到公共区域。

## MODIFIED Requirements

### Requirement: PRD 自动提取

系统 SHALL 在 Tide-discuss 讨论完成后自动提取 PRD 内容：存入 assets 表、落盘会话目录产出物，并触发 LLM 合并归档到 `shared/prd/`。

#### Scenario: 讨论完成自动提取

- **WHEN** Tide-discuss 工作流完成并产出 PRD
- **THEN** 系统自动将 PRD Markdown 存入 assets 表（type: prd）
- **THEN** 系统将 PRD 写入会话目录产出物
- **THEN** 系统触发去抖后的 LLM 合并归档（写入 `shared/prd/<域>/<feature>.md`）
- **THEN** 通过 SSE 通知前端

#### Scenario: 资产列表展示

- **WHEN** 前端收到"PRD 已生成"通知
- **THEN** 右侧资产面板自动刷新，展示资产列表
