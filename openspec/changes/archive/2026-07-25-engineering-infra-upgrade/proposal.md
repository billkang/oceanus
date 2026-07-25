## Why

Oceanus 当前处于 MVP 原型阶段，虽然代码质量和本地开发体验较好（Claude Code hooks、ESLint、Prettier 等），但缺少持续集成/部署管线、应用容器化、错误追踪、自动化代码规范检查等关键工程基础设施。这导致：（1）代码合并前无自动化质量门禁，依赖人工检查；（2）无标准交付产物，部署依赖手动操作；（3）客户端零测试覆盖；（4）手动 `git commit` 绕过 Claude Code hooks，代码规范无法保证。为支撑项目从原型阶段进入可协作、可持续迭代的成熟阶段，需要在 CI/CD、容器化、测试、Git Hooks、错误追踪五个方向补齐工程化基础。

## What Changes

### P0 — 自动化基础

- **CI/CD Pipeline**：新增 GitHub Actions workflow，PR 触发 + push main 触发生效，包含 `lint` → `typecheck` → `test(server+client)` → `build(server+client)` 四阶段
- **应用 Dockerfile**：Server 端 multi-stage build（prisma generate → nest build → 生产 dist 镜像）；Client 端 Angular build → Nginx serve，Nginx 反向代理 `/api` 到 server
- **GitHub Branch Protection**：开启 main 分支保护，要求 CI 通过才能合并

### P1 — 质量保障

- **Git Hooks**：新增 Husky + lint-staged + commitlint（Conventional Commits），与现有 Claude Code hooks 并存，覆盖手动 git 操作场景
- **客户端单元测试**：基于已有 Vitest + Angular TestBed 基础设施，为 `user-menu` 组件和 1 个核心业务页面编写测试
- **错误追踪**：docker-compose 新增 GlitchTip（MIT 开源，Sentry SDK 100% 兼容），Server（NestJS）和 Client（Angular）通过现有 Sentry SDK 接入，仅修改 DSN 指向本地 GlitchTip

## Capabilities

### New Capabilities

- `ci-cd-pipeline`：GitHub Actions 持续集成流水线，覆盖 lint、typecheck、test、build
- `app-containerization`：Server 和 Client 的 Dockerfile，支持 Docker Compose 一键启动全栈
- `git-hooks`：Husky + lint-staged + commitlint 自动化代码规范检查
- `client-testing`：客户端 Vitest + Angular TestBed 单元测试
- `error-tracking`：GlitchTip 自托管错误追踪平台集成

### Modified Capabilities

_本次为纯工程基础设施新增，不修改任何现有功能规格。_

## Impact

| 维度          | 影响                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| **CI/CD**     | 新增 `.github/workflows/ci.yml`，新增 branch protection rules                                             |
| **Docker**    | 新增 `server/Dockerfile`、`client/Dockerfile`，更新 `docker-compose.yml`（新增 GlitchTip 服务）           |
| **依赖**      | 新增 `husky`、`lint-staged`、`@commitlint/cli`、`@commitlint/config-conventional`（root devDependencies） |
| **Git Hooks** | 新增 `.husky/` 目录（pre-commit、commit-msg hooks）                                                       |
| **测试**      | 新增 `client/src/app/**/*.spec.ts` 测试文件                                                               |
| **错误追踪**  | Server 新增 `@sentry/nestjs` 依赖，Client 新增 `@sentry/angular` 依赖（或复用已有 Sentry SDK，仅改 DSN）  |
| **向后兼容**  | 无破坏性变更。所有新增内容与现有代码并存                                                                  |
