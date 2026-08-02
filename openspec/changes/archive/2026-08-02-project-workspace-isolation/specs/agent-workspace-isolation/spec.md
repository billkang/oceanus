# agent-workspace-isolation Specification

## Purpose

Agent 运行目录隔离：`query()` 固定 `cwd` 到会话专属目录、`additionalDirectories` 指向公共 PRD 区只读参考、工具权限白名单收紧（v1 禁用 Bash）、system prompt 路径感知。

## ADDED Requirements

### Requirement: 会话 cwd 固定

Agent SDK `query()` SHALL 传入 `cwd = <PROJECTS_ROOT>/<projectName>/requirements/private/<username>/<sessionId>/`，使 Agent 每次运行的工作根目录固定到当前会话专属目录。

#### Scenario: 首条消息携带 cwd

- **WHEN** 会话发出首条消息并完成会话目录创建
- **THEN** `query()` 携带 `cwd` 指向该会话目录
- **THEN** Agent 的文件操作（Write/Read）默认落在会话目录内

#### Scenario: 续传携带同一 cwd

- **WHEN** 同一 SDK 会话 resume 后续消息
- **THEN** `query()` 携带与首条消息相同的 `cwd`

### Requirement: 公共目录只读参考

`query()` SHALL 通过 `additionalDirectories` 授予对 `<PROJECTS_ROOT>/<projectName>/requirements/shared/` 的额外访问，使 Agent 可读取公共 PRD 作为讨论参考。

#### Scenario: 读取公共 PRD

- **WHEN** Agent 需要参考既有统一 PRD
- **THEN** Agent 可读取 `shared/prd/` 下的聚合文件

### Requirement: 工具权限白名单（v1 禁用 Bash）

v1 SHALL 在工具白名单中**禁用 Bash**，保留 `Write`、`Edit`、`Read`、`Grep`、`Glob`、`Skill`、`WebSearch`、`WebFetch`，限制 Agent 越界写其他项目/用户目录。

#### Scenario: Bash 不可用

- **WHEN** Agent 尝试调用 Bash 工具
- **THEN** 调用被拒绝（工具不在白名单中）

#### Scenario: 白名单工具可用

- **WHEN** Agent 调用 Write/Read/Grep/Glob/Skill 等白名单工具
- **THEN** 调用正常执行

### Requirement: system prompt 路径感知

Agent 系统提示词 SHALL 不再硬编码 `/Users/billkang/workspace/oceanus`，改为引用当前会话目录与项目工作区信息。

#### Scenario: prompt 引用会话目录

- **WHEN** 生成 Agent 系统提示词
- **THEN** 提示词中不包含任何硬编码的绝对仓库路径
- **THEN** 提示词说明"工作目录为当前会话目录，tide-discuss skill 已随项目安装"

### Requirement: 会话目录创建时点

会话目录 SHALL 在本次 `query()` 启动之前完成创建，确保 `cwd` 指向的目录必然存在。由于 SDK 的 `system/init` 事件在 `query()` 启动之后才到达，首条消息 SHALL 预生成 `session_id`（UUID）并通过 `query()` 的 `session_id` 选项注入，据此提前创建会话目录，再启动 `query()`。

#### Scenario: 首条消息创建顺序

- **WHEN** 首条消息处理（无 sdkSessionId）
- **THEN** 系统预生成一个 UUID 作为 `session_id`
- **THEN** 以该 `session_id` 创建会话目录（含 `.claude/skills` symlink）
- **THEN** `query()` 以该目录为 `cwd` 启动，并传 `session_id` 选项（`system/init` 事件返回同一 id）
- **THEN** 目录创建失败时中止本次 query 并返回错误

#### Scenario: 续传沿用同一目录

- **WHEN** 同一 SDK 会话 resume 后续消息
- **THEN** `query()` 携带与首条消息相同的 `cwd` 与 `resume` id（目录已存在，直接复用）
