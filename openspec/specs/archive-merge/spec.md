# archive-merge Specification

## Purpose

TBD - created by archiving change project-workspace-isolation. Update Purpose after archive.

## Requirements

### Requirement: PRD 落盘与 DB 记录

系统 SHALL 在检测到 PRD 产出后：将 PRD 原文写入会话目录产出物（`private/<username>/<sessionId>/` 下），并写入 DB `assets` 表（type: prd），作为索引与检索记录。

#### Scenario: 检测到 PRD 产出

- **WHEN** 会话讨论产出 PRD（含 PRD 标记或 tide-discuss 写入的 PRD 文件）
- **THEN** 系统将 PRD Markdown 写入会话目录产出物
- **THEN** 系统写入 DB `assets` 表（type: prd）
- **THEN** 通过 SSE 通知前端资产面板刷新

### Requirement: 合并触发检测（去抖）

系统 SHALL 在每轮消息后检查会话目录 PRD 产出，检测到更新后调度归档合并，并带去抖窗口（同一 PRD 连续 `ARCHIVE_DEBOUNCE_ROUNDS` 轮消息无变化才实际触发，默认 3，可配置），避免同一会话反复改写造成重复合并。

#### Scenario: 达到稳定触发合并

- **WHEN** 会话 PRD 产出更新后连续 `ARCHIVE_DEBOUNCE_ROUNDS` 轮消息无变化
- **THEN** 系统触发一次归档合并

#### Scenario: 去抖窗口内不重复触发

- **WHEN** 会话 PRD 仍在迭代改写
- **THEN** 去抖窗口内不触发重复合并
- **THEN** 稳定后再合并，同一产出只合并一次

### Requirement: 功能域归并

归档合并 SHALL 判断 PRD 所属功能域，写入 `shared/prd/<域>/<feature>.md`；已有相似域时 SHALL 优先复用（避免"用户管理/用户模块"式分裂），不存在时才新建域。

#### Scenario: 归入已有域

- **WHEN** 新 PRD 与 `shared/prd/` 下某已有域文件内容相关
- **THEN** 合并写入该已有域的聚合文件

#### Scenario: 新建域

- **WHEN** 新 PRD 不匹配任何已有域
- **THEN** 创建新域目录并写入聚合文件

### Requirement: 独立 LLM 合并调用

平台 SHALL 编排一次独立的非交互 LLM 合并调用（复用 Agent SDK 管线，一次性 query，无 sessionStore/resume）：读会话 PRD 原文与目标域聚合文件 → 语义分析整理 → 合并写回聚合文件。交互式 Agent 不直接写 `shared/`。

#### Scenario: 合并写回聚合文件

- **WHEN** 归档合并执行
- **THEN** 合并调用以会话 PRD 与现有聚合文件为输入
- **THEN** 合并结果写回 `shared/prd/<域>/<feature>.md`
- **THEN** 合并结果保留会话 PRD 中的用户信息，不丢失既有聚合内容

#### Scenario: 合并工具受限

- **WHEN** 合并调用执行
- **THEN** 其工具集限于 `Read`、`Write`、`Glob`、`Grep`（无 Bash）
- **THEN** `maxTurns` 有界（3-5），`cwd` 指向项目 requirements 根

#### Scenario: 合并失败有界重试（幂等）

- **WHEN** 合并调用失败（模型不可用 / 超时）
- **THEN** 归档任务以指数退避重试，重试有上界（如 3 次）
- **THEN** 仍失败时任务标记 failed 并保留错误日志
- **THEN** 重试不产生重复合并副作用（幂等）
- **THEN** 失败不影响数据完整性（PRD 原文始终在会话目录产出物与 assets 表），聚合文件暂落后，后续同域 PRD 再次触发合并时自然续上

### Requirement: 域文件并发锁

同一域聚合文件的并发归档合并 SHALL 串行化（per-domain mutex），防止多个会话同时合并同一文件互相覆盖。

#### Scenario: 并发合并排队

- **WHEN** 两个会话同时产出 PRD 且归入同一域文件
- **THEN** 合并任务按域文件加锁串行执行
- **THEN** 后到者基于先到者合并后的文件继续合并，不互相覆盖
