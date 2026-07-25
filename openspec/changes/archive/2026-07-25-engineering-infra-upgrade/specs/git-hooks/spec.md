## ADDED Requirements

### Requirement: pre-commit hook 自动格式化并 lint 暂存文件

Husky pre-commit hook SHALL 在每次 `git commit` 前通过 lint-staged 对暂存文件执行 Prettier 格式化和 ESLint 检查。

#### Scenario: 暂存文件格式正确且无 lint 错误

- **WHEN** 开发者执行 `git commit`，暂存文件均通过格式化检查和 lint 检查
- **THEN** commit 正常完成

#### Scenario: 暂存文件存在格式问题

- **WHEN** 开发者执行 `git commit`，暂存文件格式不符合 Prettier 规范
- **THEN** lint-staged 自动修复格式并提示用户重新暂存，commit 被阻止

#### Scenario: 暂存文件存在 lint 错误

- **WHEN** 开发者执行 `git commit`，暂存文件存在 ESLint 错误
- **THEN** commit 被阻止，终端输出具体的 lint 错误信息

### Requirement: commit-msg hook 校验提交信息格式

Husky commit-msg hook SHALL 使用 commitlint 校验提交信息是否符合 Conventional Commits 规范。

#### Scenario: 提交信息符合规范

- **WHEN** 开发者执行 `git commit -m "feat: 添加用户注册功能"`
- **THEN** commitlint 校验通过，commit 正常完成

#### Scenario: 提交信息不符合规范

- **WHEN** 开发者执行 `git commit -m "修复了一个bug"`
- **THEN** commitlint 校验失败，终端输出格式要求提示，commit 被阻止

#### Scenario: Scope 为可选项

- **WHEN** 开发者执行 `git commit -m "fix(server): 修复登录超时问题"`
- **THEN** commitlint 校验通过（带 scope）

#### Scenario: 允许的 type 列表

- **WHEN** 提交信息使用 `feat`、`fix`、`chore`、`docs`、`style`、`refactor`、`perf`、`test`、`ci`、`build` 任一 type
- **THEN** commitlint 校验通过

### Requirement: Git hooks 与 Claude Code hooks 并存

Husky hooks SHALL 与现有 Claude Code hooks（`.claude/hooks.json` 中的 PostToolUse hooks）和平共存，互不冲突。

#### Scenario: AI 编码后手动 commit

- **WHEN** Claude Code 已通过 PostToolUse hooks 完成自动格式化和 lint，用户随后执行 `git commit`
- **THEN** Husky pre-commit 二次校验，不应因已格式化过的文件报错或重复修改

#### Scenario: 手动编码后 commit

- **WHEN** 用户手动编辑文件后执行 `git commit`（无 Claude Code hooks 参与）
- **THEN** Husky pre-commit 正常执行格式化和 lint 检查
