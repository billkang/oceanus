# project-management Specification

## Purpose

项目管理能力：支持创建、查看、进入、编辑、删除项目，删除时级联清理关联的 sessions 与 assets。

## Requirements

### Requirement: 创建项目

用户 SHALL 可创建一个新项目，填写中文名称、英文标识（projectName）和备注。系统创建项目后自动把创建者设为 owner（写入 `ProjectMember`），并同步建立项目物理目录骨架、安装 tide-* skills。

#### Scenario: 成功创建项目

- **WHEN** 用户填写项目中文名称（必填）、英文标识 projectName（必填，`^[a-z0-9][a-z0-9_-]*$`，输入转小写）和备注（可选），点击创建
- **THEN** 系统先建立项目物理目录骨架（见"创建物理目录骨架与 skills"）
- **THEN** 骨架成功后系统创建项目记录并自动写入一条 `ProjectMember`（当前用户，role: owner，同一 Prisma 事务）
- **THEN** 自动跳转到项目工作区（三栏布局）

#### Scenario: 创建物理目录骨架与 skills

- **WHEN** 创建项目流程启动且 projectName 通过唯一性预校验
- **THEN** 系统先建立 `<PROJECTS_ROOT>/<projectName>/requirements/shared/prd/`、`requirements/private/`、`repo/` 目录骨架（FS 先行，DB 未动）
- **THEN** 目录骨架创建失败时项目创建直接失败，DB 无任何记录（无需补偿逻辑）
- **THEN** 骨架成功后系统创建项目记录并写入 owner ProjectMember（同一 Prisma 事务）
- **THEN** DB 创建失败时 best-effort 清理刚建立的空目录（罕见路径：projectName 唯一性已预校验）
- **THEN** 最后将 tide-* skills 安装到 `<projectName>/.claude/skills/`，skills 安装失败不阻断项目创建，记录错误日志（后续惰性刷新补装）

#### Scenario: 项目名称为空

- **WHEN** 用户未填写项目名称直接点击创建
- **THEN** 创建按钮不可用，或提示"项目名称不能为空"

#### Scenario: projectName 非法或冲突

- **WHEN** 用户填写 projectName 包含大写字母、空格或非法字符
- **THEN** 校验失败，提示 projectName 仅允许小写字母、数字、`-`、`_`
- **WHEN** projectName 已存在（活跃记录）
- **THEN** 提示"该英文标识已被使用"（部分唯一索引 `WHERE deleted_at IS NULL`）

### Requirement: 项目列表

登录后系统 SHALL 展示当前用户**是成员**的项目列表（通过 `ProjectMember` 过滤），支持查看项目。列表仅展示未删除（`deleted_at IS NULL`）的项目。

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

#### Scenario: 访问已删除项目路由

- **WHEN** 用户访问已软删项目的 `/projects/:projectName` 路由
- **THEN** 返回 404（与不存在等价）

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

用户 SHALL 可删除项目。仅 owner 可删除。删除为**逻辑删除**：事务级联置项目、其成员、其所有会话（含会话消息、资产）的 `deleted_at`，并将项目物理目录 `rename` 进 `.trash/`。

#### Scenario: 删除前确认

- **WHEN** 用户点击删除按钮
- **THEN** 弹出二次确认弹窗

#### Scenario: 确认删除

- **WHEN** 当前用户是项目 owner，用户确认删除
- **THEN** 前端 DELETE `/api/v1/projects/:projectName`
- **THEN** 服务端在单个 Prisma `$transaction` 中级联置 `deleted_at`（项目 → ProjectMember → sessions → session_entries → assets）
- **THEN** 项目物理目录 `rename` 进 `.trash/<projectName>-<时间戳>/`
- **THEN** 任一 DB 操作失败则整体回滚
- **THEN** 项目从列表中消失（读查询过滤 `deleted_at IS NULL`），数据可从裸表/回收站恢复

#### Scenario: 非 owner 删除

- **WHEN** 当前用户是项目 member（非 owner）尝试删除项目
- **THEN** 返回 404

#### Scenario: 取消删除

- **WHEN** 用户取消删除
- **THEN** 不执行任何操作，关闭弹窗
