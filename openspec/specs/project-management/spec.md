## ADDED Requirements

### Requirement: 创建项目
用户可创建一个新项目，填写名称和备注。

#### Scenario: 成功创建项目
- **WHEN** 用户填写项目名称（必填）和备注（可选），点击创建
- **THEN** 系统创建项目记录，自动跳转到项目工作区（三栏布局）

#### Scenario: 项目名称为空
- **WHEN** 用户未填写项目名称直接点击创建
- **THEN** 创建按钮不可用，或提示"项目名称不能为空"

### Requirement: 项目列表
登录后直接展示用户的项目列表，支持查看已创建的项目。

#### Scenario: 有项目时展示列表
- **WHEN** 用户登录成功进入项目列表页
- **THEN** 展示所有项目的卡片列表（名称 + 备注 + 创建时间），按时间倒序排列

#### Scenario: 无项目时展示空状态
- **WHEN** 用户还没有创建任何项目
- **THEN** 展示空状态提示"暂无项目，点击创建第一个项目"

### Requirement: 进入项目
点击项目卡片进入该项目的工作区。

#### Scenario: 进入项目
- **WHEN** 用户点击某个项目卡片
- **THEN** 系统导航到 `/projects/:id` 工作区路由

### Requirement: 编辑项目
用户可修改已有项目的名称和备注。

#### Scenario: 编辑项目
- **WHEN** 用户在项目列表页点击编辑按钮
- **THEN** 弹出编辑对话框，预填当前名称和备注
- **WHEN** 用户修改并确认
- **THEN** 前端 PATCH `/api/v1/projects/:id`，更新项目信息

#### Scenario: 编辑时名称为空
- **WHEN** 用户清空项目名称
- **THEN** 确认按钮不可用

### Requirement: 删除项目
用户可删除项目，级联清理关联数据。

#### Scenario: 删除前确认
- **WHEN** 用户点击删除按钮
- **THEN** 弹出二次确认弹窗

#### Scenario: 确认删除
- **WHEN** 用户确认删除
- **THEN** 前端 DELETE `/api/v1/projects/:id`
- **THEN** 项目及其关联的 sessions 和 assets 级联删除（数据库 onDelete: Cascade）
- **THEN** 项目从列表中消失

#### Scenario: 取消删除
- **WHEN** 用户取消删除
- **THEN** 不执行任何操作，关闭弹窗
