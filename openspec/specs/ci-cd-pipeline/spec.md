# CI/CD Pipeline

## Purpose

定义 GitHub Actions CI 流水线，确保每次代码变更都经过 lint、类型检查、测试和构建验证，保障代码质量。

## Requirements

### Requirement: CI workflow 在 PR 和 push main 时触发

CI pipeline SHALL 在以下事件时自动运行：

- Pull Request 的 `opened`、`synchronize`、`reopened` 事件
- push 到 `main` 分支

#### Scenario: PR 提交触发 CI

- **WHEN** 开发者向任意分支提交 PR
- **THEN** GitHub Actions 自动运行完整的 lint → typecheck → test → build 流水线

#### Scenario: Push main 触发 CI

- **WHEN** 代码被合并或直接 push 到 main 分支
- **THEN** GitHub Actions 自动运行完整的 lint → typecheck → test → build 流水线

### Requirement: CI 流水线包含四阶段检查

CI pipeline SHALL 按顺序执行 lint、typecheck、test、build 四个阶段，每个阶段通过后才进入下一阶段，任一阶段失败即终止流水线。

#### Scenario: Lint 阶段

- **WHEN** CI 流水线启动
- **THEN** 系统并行对 server/ 和 client/ 目录执行 ESLint 检查，失败时流水线终止

#### Scenario: Typecheck 阶段

- **WHEN** lint 阶段全部通过
- **THEN** 系统并行对 server/ 和 client/ 目录执行 TypeScript 类型检查（`tsc --noEmit`），失败时流水线终止

#### Scenario: Test 阶段

- **WHEN** typecheck 阶段全部通过
- **THEN** 系统并行对 server/ 和 client/ 执行 vitest 测试套件，失败时流水线终止

#### Scenario: Build 阶段

- **WHEN** test 阶段全部通过
- **THEN** 系统并行对 server/ 和 client/ 执行生产构建（`nest build` + `ng build`），失败时流水线终止

### Requirement: CI 使用 pnpm 缓存加速

CI pipeline SHALL 利用 GitHub Actions cache 缓存 pnpm store 和 node_modules，避免每次从头安装依赖。

#### Scenario: pnpm store 缓存命中

- **WHEN** CI 流水线运行且 `pnpm-lock.yaml` 未变更
- **THEN** 系统从缓存恢复 pnpm store，`pnpm install` 耗时显著减少

#### Scenario: pnpm store 缓存失效

- **WHEN** `pnpm-lock.yaml` 发生变更
- **THEN** 系统重新执行完整 `pnpm install`，并更新缓存

### Requirement: 分支保护要求 CI 通过

main 分支 SHALL 配置 GitHub Branch Protection，要求 CI 通过后方可合并 PR。

#### Scenario: CI 通过的 PR 可合并

- **WHEN** PR 的 CI 流水线全部通过
- **THEN** 合并按钮可用，允许合并到 main

#### Scenario: CI 失败的 PR 被阻止合并

- **WHEN** PR 的 CI 流水线任一阶段失败
- **THEN** 合并按钮不可用，PR 无法合并到 main
