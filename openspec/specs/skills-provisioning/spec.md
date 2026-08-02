# skills-provisioning Specification

## Purpose

TBD - created by archiving change project-workspace-isolation. Update Purpose after archive.

## Requirements

### Requirement: deepstorm 集成（spawn CLI）

Server SHALL 以 npm 依赖引入 `@deepstorm/cli`（提供 CLI 二进制），通过 `child_process` 以 cwd=项目目录 spawn `deepstorm setup --non-interactive --tools tide` 完成 skills 安装；版本查询通过读取 `@deepstorm/cli` 的 `package.json` version。集成点统一封装为 `SkillsProvider` 接口（安装 / 版本查询 / 刷新），版本随依赖升级。

#### Scenario: 依赖已引入

- **WHEN** server 启动
- **THEN** 可通过 `SkillsProvider` 接口以 cwd=项目目录 spawn `deepstorm setup` 安装 skills，并读取 `@deepstorm/cli` 版本

#### Scenario: 版本随依赖更新

- **WHEN** `deepstorm` 发布新版本
- **THEN** 通过 `pnpm update @deepstorm/cli` 升级依赖，刷新比对基于新版本号自动触发

### Requirement: 项目创建安装 skills

创建项目 SHALL 将 tide-* skills 安装到 `<PROJECTS_ROOT>/<projectName>/.claude/skills/`，使该项目的所有会话 Agent 可发现这些 skill。

#### Scenario: 创建时安装

- **WHEN** 项目创建成功
- **THEN** tide-* skills 被安装到 `<projectName>/.claude/skills/`
- **THEN** 安装失败不阻断项目创建（可后续惰性刷新补装），但记录错误日志

#### Scenario: 重复安装幂等

- **WHEN** skills 已存在时再次安装
- **THEN** 不产生重复目录，安装为幂等操作

### Requirement: 版本惰性刷新

会话开始前 SHALL 比对项目 skills 版本标记与 `@deepstorm/cli` 当前版本，发现落后时自动重装，保证已有项目跟随 deepstorm 发版。版本标记存于项目 `.claude/skills/.deepstorm-skills.json`（`{ installedVersion, installedAt }`），与 skills 同置一处，刷新判断零 DB 开销。

#### Scenario: 版本一致跳过

- **WHEN** 项目 `.claude/skills/.deepstorm-skills.json` 的 `installedVersion` 与当前 `@deepstorm/cli` 版本一致
- **THEN** 跳过安装，直接进入会话

#### Scenario: 版本落后重装

- **WHEN** 项目版本标记低于当前 `@deepstorm/cli` 版本
- **THEN** 自动重装 tide-* skills 并更新版本标记文件

#### Scenario: 无版本标记

- **WHEN** 项目目录无 `.deepstorm-skills.json` 标记（如旧项目、手动补建）
- **THEN** 视为落后，执行安装并写入版本标记文件

### Requirement: 安装范围限定

v1 SHALL 只安装 tide-_（产品侧，语言无关）；reef-_（开发侧，语言相关）SHALL 推迟到代码生成阶段按项目语言安装。已安装 skills 经各会话目录的 `.claude/skills` symlink 暴露给会话 Agent，无需每会话复制。

#### Scenario: 仅安装 tide-*

- **WHEN** 项目创建 / 惰性刷新安装 skills
- **THEN** 安装范围仅含 tide-* 套件
- **THEN** reef-* 不在本次安装范围内

#### Scenario: 会话经 symlink 发现

- **WHEN** 会话目录懒创建完成（含 `.claude/skills` symlink）
- **THEN** 该会话 Agent 可在 cwd 直属目录发现 tide-* skills（见 project-workspace「会话目录懒创建」）
