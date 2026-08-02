# project-management Specification

## Purpose

项目管理能力：支持创建、查看、进入、编辑、删除项目，删除时级联清理关联的 sessions 与 assets。
## Requirements
### Requirement: 创建项目

用户 SHALL 可创建一个新项目，填写中文名称、英文标识（projectName）和备注。系统创建项目后自动把创建者设为 owner（写入 `ProjectMember`）。

#### Scenario: 成功创建项目

- **WHEN** 用户填写项目中文名称（必填）、英文标识 projectName（必填，`^[a-z0-9][a-z0-9_-]*$`，输入转小写）和备注（可选），点击创建
- **THEN** 系统创建项目记录
- **THEN** 系统自动写入一条 `ProjectMember`（当前用户，role: owner）
- **THEN** 自动跳转到项目工作区（三栏布局）

#### Scenario: 项目名称为空

- **WHEN** 用户未填写项目名称直接点击创建
- **THEN** 创建按钮不可用，或提示"项目名称不能为空"

#### Scenario: projectName 非法或冲突

- **WHEN** 用户填写 projectName 包含大写字母、空格或非法字符
- **THEN** 校验失败，提示 projectName 仅允许小写字母、数字、`-`、`_`
- **WHEN** projectName 已存在
- **THEN** 提示"该英文标识已被使用"（数据库 `@unique` 约束）

### Requirement: 项目列表

登录后系统 SHALL 展示当前用户**是成员**的项目列表（通过 `ProjectMember` 过滤），支持查看项目。

#### Scenario: 有项目时展示列表

- **WHEN** 用户登录成功进入项目列表页
- **THEN** 展示当前用户是成员的所有项目的卡片列表（名称 + projectName + 备注 + 创建时间），按时间倒序排列
- **THEN** 非成员的项目不展示

#### Scenario: 无项目时展示空状态

- **WHEN** 用户还不是任何项目的成员
- **THEN** 展示空状态提示"暂无项目，点击创建第一个项目"

### Requirement: 进入项目

点击项目卡片后 SHALL 进入该项目的工作区。路由使用 `projectName` 作为项目标识。

#### Scenario: 进入项目

- **WHEN** 用户点击某个项目卡片
- **THEN** 系统导航到 `/projects/:projectName` 工作区路由

#### Scenario: 访问非成员项目路由

- **WHEN** 用户访问非成员项目的 `/projects/:projectName` 路由
- **THEN** 返回 404（项目列表只展示成员项目，正常情况下前端无此入口）

### Requirement: 编辑项目

用户 SHALL 可修改已有项目的中文名称和备注。仅 owner 可编辑，`projectName` 不可修改；非 owner 编辑返回 404。

#### Scenario: 编辑项目

- **WHEN** 当前用户是项目 owner，在项目列表页点击编辑按钮
- **THEN** 弹出编辑对话框，预填当前名称和备注（projectName 只读展示）
- **WHEN** 用户修改并确认
- **THEN** 前端 PATCH `/api/v1/projects/:projectName`，更新项目信息

#### Scenario: 编辑时名称为空

- **WHEN** 用户清空项目名称
- **THEN** 确认按钮不可用

#### Scenario: 非 owner 编辑

- **WHEN** 当前用户是项目 member（非 owner）尝试编辑项目
- **THEN** 返回 404

### Requirement: 删除项目

用户 SHALL 可删除项目，级联清理关联数据。仅 owner 可删除。删除时清理该项目所有用户分区的会话记录。

#### Scenario: 删除前确认

- **WHEN** 用户点击删除按钮
- **THEN** 弹出二次确认弹窗

#### Scenario: 确认删除

- **WHEN** 当前用户是项目 owner，用户确认删除
- **THEN** 前端 DELETE `/api/v1/projects/:projectName`
- **THEN** 服务端在单个 Prisma `$transaction` 中删除 `SessionEntry`（`partitionKey LIKE '${projectName}/%'`，覆盖所有用户分区）与项目记录
- **THEN** 项目及其关联的 ProjectMember、sessions 和 assets 级联删除（数据库 onDelete: Cascade）
- **THEN** 任一删除失败则整体回滚
- **THEN** 项目从列表中消失

#### Scenario: 非 owner 删除

- **WHEN** 当前用户是项目 member（非 owner）尝试删除项目
- **THEN** 返回 404

#### Scenario: 取消删除

- **WHEN** 用户取消删除
- **THEN** 不执行任何操作，关闭弹窗

