# soft-delete Specification

## Purpose

TBD - created by archiving change project-workspace-isolation. Update Purpose after archive.

## Requirements

### Requirement: 软删 schema

数据模型 SHALL 为 projects、sessions、project_members、session_entries、assets 5 张表增加可空的 `deleted_at` 列；原 `@unique` 约束（如 project.name）SHALL 改为部分唯一索引（`WHERE deleted_at IS NULL`）。

#### Scenario: 迁移应用

- **WHEN** 数据库迁移执行
- **THEN** 5 张表存在 `deleted_at` 列
- **THEN** 活跃记录的 `deleted_at` 为 NULL，删除后的记录置为删除时间

#### Scenario: 删除后可重建同名

- **WHEN** 某项目已软删（deleted_at 非空）
- **THEN** 新项目可使用相同的 projectName 创建（部分唯一索引不阻止）

#### Scenario: 活跃同名仍冲突

- **WHEN** 某项目未删除（deleted_at 为 NULL）
- **THEN** 新项目使用相同 projectName 创建失败（部分唯一索引生效）

### Requirement: 读查询过滤

所有读取数据的查询 SHALL 过滤 `deleted_at IS NULL`，被删除的记录对业务查询不可见。

#### Scenario: 列表不显示已删项

- **WHEN** 查询项目列表 / 会话列表 / 资产列表
- **THEN** 返回结果不包含 `deleted_at` 非空的记录

#### Scenario: 已删资源访问 404

- **WHEN** 通过 id / projectName 访问已软删的项目、会话或资产
- **THEN** 返回 404（与不存在等价）

### Requirement: 删除事务级联 + 回收站

删除操作 SHALL 在单个事务内级联置 `deleted_at`（项目 → 成员 / 会话 / 会话消息 / 资产），并将对应物理目录 `rename` 进 `.trash/`。物理目录操作失败 SHALL 记录错误但不回滚 DB 软删（可后续手工恢复）。

#### Scenario: 删除项目

- **WHEN** owner 确认删除项目
- **THEN** 事务内置项目、其成员、其所有会话、会话消息、资产的 `deleted_at`
- **THEN** 项目物理目录 `rename` 进 `.trash/<projectName>-<时间戳>/`
- **THEN** 项目从列表中消失，但数据可从裸表/回收站恢复

#### Scenario: 删除会话

- **WHEN** 用户删除某会话
- **THEN** 事务内置该会话及其消息、资产的 `deleted_at`
- **THEN** 会话目录 `rename` 进 `.trash/<sessionId>-<时间戳>/`

#### Scenario: 目录移动失败不阻断 DB

- **WHEN** 物理目录移动失败（如权限 / 不存在）
- **THEN** 记录错误日志
- **THEN** DB 软删照常提交，目录可后续手工处理
