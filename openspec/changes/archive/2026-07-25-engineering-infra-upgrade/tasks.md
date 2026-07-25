## 1. Git Hooks — Husky + lint-staged + commitlint

- [x] 1.1 安装依赖：`husky`、`lint-staged`、`@commitlint/cli`、`@commitlint/config-conventional` 到根 package.json
- [x] 1.2 创建 `.lintstagedrc.json`，配置 Prettier 格式化和 ESLint 修复规则
- [x] 1.3 创建 `commitlint.config.mjs`，继承 `@commitlint/config-conventional`，scope 设为可选
- [x] 1.4 配置 `package.json` 的 `prepare` 脚本初始化 Husky
- [x] 1.5 创建 `.husky/pre-commit` hook（含 lint-staged + server lint + typecheck + test 全量检查）
- [x] 1.6 创建 `.husky/commit-msg` hook，调用 `npx commitlint --edit $1`
- [x] 1.7 验证：手动 `git commit` 一次，确认 pre-commit 和 commit-msg 均正常触发

## 2. CI/CD Pipeline — GitHub Actions

- [x] 2.1 创建 `.github/workflows/ci.yml`，定义 `lint` → `typecheck` → `test` → `build` 多 job 流水线
- [x] 2.2 配置 pnpm setup（使用 `pnpm/action-setup@v4` + `actions/setup-node` 的 `cache: 'pnpm'`）
- [x] 2.3 实现 lint job：server 和 client 并行 ESLint
- [x] 2.4 实现 typecheck job：server 和 client 并行 `tsc`
- [x] 2.5 实现 test job：server 和 client 并行 vitest run
- [x] 2.6 实现 build job：server（`nest build`）和 client（`ng build`）并行
- [x] 2.7 配置 GitHub Branch Protection，要求 CI 通过才能合并到 main
- [x] 2.8 验证：提交 PR 触发 CI，确认流水线全部通过

## 3. 应用容器化 — Dockerfile + Health Check

- [x] 3.1 安装 `@nestjs/terminus` 依赖到 server
- [x] 3.2 创建 `server/src/health/health.module.ts` 和 `health.controller.ts`，实现 `/api/health` 端点
- [x] 3.3 在 `server/src/app.module.ts` 中注册 `HealthModule`
- [x] 3.4 创建 `server/Dockerfile`（multi-stage build：prisma generate + nest build → production）
- [x] 3.5 创建 `server/entrypoint.sh`（prisma migrate deploy → node dist/main.js）
- [x] 3.6 创建 `server/.dockerignore`（排除 node_modules、dist、.git 等）
- [x] 3.7 创建 `client/Dockerfile`（Angular build → Nginx serve）
- [x] 3.8 创建 `client/nginx.conf`（SPA fallback + /api 反向代理到 server:3100）
- [x] 3.9 创建 `client/.dockerignore`
- [x] 3.10 更新 `docker-compose.yml`：新增 server/client/glitchtip-web/glitchtip-worker 服务，均归入 `app` profile

## 4. 错误追踪 — GlitchTip 集成

- [x] 4.1 安装 `@sentry/node` 到 server 依赖
- [x] 4.2 在 `server/src/main.ts` 中初始化 Sentry，从 `GLITCHTIP_DSN` 环境变量读取 DSN
- [x] 4.3 更新 `server/.env.example`，新增 `GLITCHTIP_DSN` 变量及说明
- [x] 4.4 安装 `@sentry/angular` 到 client 依赖
- [x] 4.5 在 `client/src/main.ts` 中初始化 Sentry（`bootstrapApplication` 之前）
- [x] 4.6 更新 `client/src/environments/environment.ts` 和 `environment.prod.ts`，新增 `glitchtipDsn` 字段
- [x] 4.7 验证：启动 GlitchTip → 创建项目 → 配置 DSN → 触发错误 → 在 Dashboard 中确认上报（操作指南见 README.md "接入 GlitchTip 错误追踪"）

## 5. 客户端测试 — Vitest + Angular TestBed

- [x] 5.1 创建 `client/src/app/user-menu/user-menu.component.spec.ts`，覆盖组件创建、用户信息展示、菜单交互
- [x] 5.2 创建 `client/src/app/chat/chat.component.spec.ts`，覆盖消息列表渲染、输入交互、流式状态
- [x] 5.3 运行 `pnpm --filter @oceanus/client test`，确保新增测试全部通过（通过 `NODE_OPTIONS='--no-experimental-webstorage'` 禁用 Node.js v25 内建 localStorage，让 jsdom 提供正确的 Storage API）
- [x] 5.4 验证：CI test job 中客户端测试正常执行并通过
