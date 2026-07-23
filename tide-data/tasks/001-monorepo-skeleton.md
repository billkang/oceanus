# 任务 001 — 初始化 NestJS + Prisma + Angular monorepo 项目骨架

**Epic:** 项目脚手架与基础设施
**优先级:** P0
**关联需求:** —

---

## 描述

搭建 Oceanus MVP 的 monorepo 项目骨架，包含以下三个子项目：

- `backend/` — NestJS 后端服务
- `frontend/` — Angular SPA 前端
- 根目录 package.json 统一管理

## 验收标准

- [ ] 根目录有 `package.json`，支持 `pnpm` 或 `npm workspaces` monorepo 管理
- [ ] `backend/` 可运行 `npm run start:dev` 启动 NestJS 开发服务器
- [ ] `frontend/` 可运行 `npm run start` 启动 Angular 开发服务器
- [ ] 前端能通过 proxy 配置代理到后端端口
- [ ] 项目根目录有 `.gitignore` 忽略 `node_modules/`、`dist/`、`.env` 等
- [ ] 配置好 ESLint + Prettier

## 技术要点

- 后端：NestJS（TypeScript），使用 `@nestjs/cli` 初始化
- 前端：Angular + PrimeNG + Tailwind CSS，使用 `@angular/cli` 初始化
- 使用 `pnpm workspaces` 管理 monorepo
- 约定端口：后端 3100，前端 4300
