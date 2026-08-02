# project-workspace Specification

## Purpose

项目物理目录生命周期管理：`PROJECTS_ROOT` 配置、项目创建时建立目录骨架、统一路径构建（防穿越）、会话目录懒创建、删除时物理目录进回收站（`.trash/` rename）。

## ADDED Requirements

### Requirement: PROJECTS_ROOT 配置

Server SHALL 从环境变量 `PROJECTS_ROOT` 读取项目物理目录根；未配置时使用默认路径。根目录不存在时 SHALL 在启动时自动创建。

#### Scenario: 环境变量已配置

- **WHEN** 环境变量 `PROJECTS_ROOT` 指向某绝对路径且 server 启动
- **THEN** 该路径作为项目物理目录根，且启动时若目录不存在则自动创建

#### Scenario: 未配置使用默认

- **WHEN** 环境变量 `PROJECTS_ROOT` 未设置或为空
- **THEN** server 使用默认根路径（如 `./projects`），并记录 WARN 日志

### Requirement: 项目目录骨架创建

创建项目时 SHALL 同步建立项目专属物理目录骨架：`<PROJECTS_ROOT>/<projectName>/requirements/shared/prd/`、`requirements/private/`、`repo/`。

#### Scenario: 成功创建骨架

- **WHEN** 创建项目流程启动且 projectName 通过唯一性预校验
- **THEN** 系统建立 `requirements/shared/prd/`、`requirements/private/`、`repo/` 目录
- **THEN** 目录创建失败时项目创建直接失败，DB 无任何记录（FS 先行，无半成品残留）

#### Scenario: 骨架创建幂等

- **WHEN** 目录骨架已存在时再次执行创建（如创建事务重试、同一会话补建）
- **THEN** 不报错，目录保持原状

#### Scenario: 残留目录处理

- **WHEN** `<PROJECTS_ROOT>/<projectName>/` 已存在但非本次创建流程产物（如上次软删后 rename 失败留下的残留）
- **THEN** 骨架创建前先将该目录 `rename` 进 `.trash/<projectName>-<时间戳>/`
- **THEN** rename 失败（如权限 / 占用）时项目创建失败，提示处理残留目录
- **THEN** 处理后再以空目录建立全新骨架，杜绝新旧数据混杂

### Requirement: 统一路径构建

系统 SHALL 提供统一的路径构建工具，基于 `projectName` / `username` / `sessionId` 构建会话目录、公共 PRD 目录、回收站路径，并对所有输入做合法性校验以防范路径穿越。

#### Scenario: 构建会话目录路径

- **WHEN** 给定 projectName、username、sessionId
- **THEN** 返回 `<PROJECTS_ROOT>/<projectName>/requirements/private/<username>/<sessionId>/`

#### Scenario: 非法标识拒绝

- **WHEN** projectName / username / sessionId 包含 `..`、`/`、`\` 或为空
- **THEN** 路径构建抛错或返回 null，禁止产生越界路径

### Requirement: 会话目录懒创建

首次消息捕获 SDK `session_id`（`system/init`）后 SHALL 创建 `private/<username>/<sessionId>/` 会话专属目录，并在会话目录内建立 `.claude/skills` 符号链接指向项目根 `.claude/skills`（保证 cwd=会话目录时 tide-* skills 结构上必然可发现，不依赖 SDK 向上回溯行为）；同一会话目录不重复创建。

#### Scenario: 首次会话创建

- **WHEN** 首条消息捕获到新的 SDK session_id
- **THEN** 创建 `private/<username>/<sessionId>/` 目录
- **THEN** 会话目录内建立 `.claude/skills` symlink → `<projectName>/.claude/skills`（项目根 skills 更新自动跟随）

#### Scenario: 目录已存在

- **WHEN** 会话目录已存在（如续传、重试）
- **THEN** 不重复创建，直接复用（symlink 已存在不重建）

### Requirement: 物理目录进回收站

任何删除操作（项目 / 会话）SHALL 将对应物理目录 `rename` 到 `<PROJECTS_ROOT>/.trash/<原目录名>-<时间戳>/`，不得直接 `unlink`。v1 回收站只进不出，清理策略后续版本实现。

#### Scenario: 项目删除进回收站

- **WHEN** 删除项目
- **THEN** 项目物理目录整体 `rename` 到 `.trash/<projectName>-<时间戳>/`

#### Scenario: 会话删除进回收站

- **WHEN** 删除会话
- **THEN** 会话目录 `rename` 到 `.trash/<sessionId>-<时间戳>/`

#### Scenario: 回收站路径自动创建

- **WHEN** `.trash/` 目录尚不存在
- **THEN** 在首次进入回收站操作时自动创建

#### Scenario: 回收站内重名不覆盖

- **WHEN** `.trash/` 中已存在同名目录
- **THEN** 以时间戳后缀保证唯一，不覆盖已有回收项
