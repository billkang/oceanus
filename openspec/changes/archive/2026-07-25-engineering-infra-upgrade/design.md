## Context

Oceanus 是 Angular 21 + NestJS 11 的 pnpm workspace monorepo，当前处于 MVP 原型阶段。代码质量工具已配置（ESLint 9 flat config、Prettier、Claude Code hooks），但缺少持续集成管线、应用容器化、错误追踪系统、客户端测试和传统 Git hooks。本次设计覆盖 P0+P1 五个方向的技术决策与实施方案。

## Goals / Non-Goals

**Goals:**

- 建立 GitHub Actions CI 流水线，PR + push main 自动 lint/typecheck/test/build
- 提供 Server 和 Client 的生产级 Dockerfile，支持 `docker compose --profile app up -d` 一键启动全栈
- 接入 GlitchTip 自托管错误追踪（Sentry SDK 兼容）
- 建立客户端单元测试基础设施和核心组件测试示例
- 通过 Husky + lint-staged + commitlint 覆盖手动 git 操作场景

**Non-Goals:**

- 不做生产环境部署（k8s、云服务），Docker Compose 是交付边界
- 不做 Nx/Turborepo 构建编排（留到 P2）
- 不做 E2E 测试（留到 P2）
- 不做测试覆盖率门禁
- 不做多阶段部署（staging/canary），单环境即可
- Scale 边界：单机部署（不涉及水平扩展），并发用户 < 50，单会话消息 < 1000 条
- GlitchTip 数据备份和灾备（留到后续）

## Decisions

### 1. CI/CD: GitHub Actions 多 Job 并行架构

**选择**: 多 Job 依赖 + server/client 并行 **替代**: 单 Job 串行

```mermaid
flowchart LR
    LINT["lint (server ∥ client)"] --> TC["typecheck (server ∥ client)"]
    TC --> TEST["test (server ∥ client)"]
    TEST --> BUILD["build (server ∥ client)"]
```

- 每个阶段内 server 和 client 在不同 step 中并行（或使用 matrix strategy）
- pnpm store 使用 `actions/setup-node` 内置缓存（`cache: 'pnpm'`）
- Node.js 版本：`22.x`（与 Docker 基础镜像一致）

### 2. Docker: Multi-stage Build + Profile 分离

**Server Dockerfile** (`server/Dockerfile`):

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY server/prisma server/prisma/
RUN corepack enable && pnpm install --frozen-lockfile
COPY server/ server/
RUN pnpm --filter @oceanus/server prisma:generate
RUN pnpm --filter @oceanus/server build

# Stage 2: Production
FROM node:22-alpine AS production
WORKDIR /app
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://localhost:3100/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
```

- `entrypoint.sh`：先执行 `npx prisma migrate deploy`，再 `node dist/main.js`
- Stage 1 中 `pnpm install` 仅需 server 的依赖
- Prisma Client 在 build 阶段生成，production 阶段直接复制

**Client Dockerfile** (`client/Dockerfile`):

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
RUN corepack enable && pnpm install --frozen-lockfile
COPY client/ client/
RUN pnpm --filter @oceanus/client build

# Stage 2: Nginx
FROM nginx:stable-alpine
COPY --from=build /app/client/dist/oceanus/browser /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# client/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # API reverse proxy
    location /api/ {
        proxy_pass http://server:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Compose Profile 设计**:

```yaml
# 基础设施（默认启动）
postgres, redis, clickhouse, minio, langfuse-worker, langfuse-web

# 应用 profile（--profile app）
server:
  profiles: [app]
  build: ./server
  ports: ["3100:3100"]
  environment:
    DATABASE_URL: postgresql://root:123456@postgres:5432/oceanus
    GLITCHTIP_DSN: http://glitchtip-web:8000/1
  depends_on: [postgres]

client:
  profiles: [app]
  build: ./client
  ports: ["80:80"]
  depends_on: [server]

glitchtip-web:
  profiles: [app]
  image: glitchtip/glitchtip:6
  # ...

glitchtip-worker:
  profiles: [app]
  image: glitchtip/glitchtip:6
  # ...
```

### 3. GlitchTip: 自托管错误追踪

**选择**: GlitchTip（MIT 开源） **替代**: Sentry Self-Hosted（资源过重，~14GB RAM）

**架构**:

```
┌──────────────┐    ┌──────────────┐
│ NestJS Server │    │ Angular App  │
│ @sentry/node  │    │@sentry/angular│
└──────┬───────┘    └──────┬───────┘
       │ DSN →              │ DSN →
       ▼                    ▼
┌──────────────────────────────────┐
│         GlitchTip Web (8000)      │
│  Django app + Sentry API compat  │
├──────────────────────────────────┤
│   GlitchTip Worker (Celery)       │
├──────────────────────────────────┤
│   PG (复用)    │   Redis (复用)    │
└──────────────────────────────────┘
```

- **DSN 配置**: Server 用 `GLITCHTIP_DSN` 环境变量；Client 用 Angular `environment.*.ts` 注入
- **SDK**: `@sentry/node`（Server）+ `@sentry/angular`（Client），GlitchTip 兼容标准 Sentry SDK
- **首次初始化**: 手动在 GlitchTip Web UI 创建项目 → 复制 DSN → 填入 `.env` / `environment.prod.ts`

### 4. Git Hooks: Husky + lint-staged + commitlint

**选择**: Husky 9 + lint-staged + @commitlint/config-conventional **替代**: pre-commit（Python ecosystem，不适合 Node.js 项目）

```json
// .lintstagedrc.json
{
  "*.{ts,js,html,css,json,md}": ["prettier --write"],
  "*.ts": ["eslint --fix"]
}
```

```bash
# commitlint.config.mjs
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [0], // scope 可选
  },
}
```

- pre-commit: lint-staged → Prettier → ESLint
- commit-msg: commitlint 校验 Conventional Commits
- 与 Claude Code hooks 共存：Claude Code 的 PostToolUse hooks 已做格式化和 code-style 校验，Husky 作为二次门禁

### 5. Client Testing: Vitest + Angular TestBed

**选择**: 已有 Vitest + jsdom + TestBed 基础设施，复用不新增 **替代**: Jest + karma（Angular 传统方案，但项目已选 Vitest）

**测试文件**:

- `client/src/app/user-menu/user-menu.component.spec.ts`
- `client/src/app/chat/chat.component.spec.ts`

**测试策略**: 组件创建、数据绑定、用户交互、边界状态。使用 `ComponentHarness` 做 DOM 交互测试。

### 6. Health Check: NestJS Terminus

**选择**: `@nestjs/terminus` **替代**: 手写 health controller

```typescript
// server/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.prisma.pingCheck('database')]);
  }
}
```

## Change Scope Matrix

| 变更类型 | 文件/目录                                              | 影响范围                                              | Capability                           |
| -------- | ------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------ |
| **新增** | `.github/workflows/ci.yml`                             | CI 配置                                               | ci-cd-pipeline                       |
| **新增** | `server/Dockerfile`                                    | Server 容器化                                         | app-containerization                 |
| **新增** | `server/entrypoint.sh`                                 | 启动脚本                                              | app-containerization                 |
| **新增** | `server/.dockerignore`                                 | Docker 构建排除                                       | app-containerization                 |
| **新增** | `client/Dockerfile`                                    | Client 容器化                                         | app-containerization                 |
| **新增** | `client/nginx.conf`                                    | Nginx SPA + 反向代理                                  | app-containerization                 |
| **新增** | `client/.dockerignore`                                 | Docker 构建排除                                       | app-containerization                 |
| **修改** | `docker-compose.yml`                                   | 新增 app profile 服务                                 | app-containerization, error-tracking |
| **新增** | `server/src/health/health.controller.ts`               | 健康检查端点                                          | app-containerization                 |
| **新增** | `server/src/health/health.module.ts`                   | 健康检查模块                                          | app-containerization                 |
| **新增** | `.husky/pre-commit`                                    | pre-commit hook                                       | git-hooks                            |
| **新增** | `.husky/commit-msg`                                    | commit-msg hook                                       | git-hooks                            |
| **新增** | `.lintstagedrc.json`                                   | lint-staged 配置                                      | git-hooks                            |
| **新增** | `commitlint.config.mjs`                                | commitlint 配置                                       | git-hooks                            |
| **修改** | `root package.json`                                    | 新增 husky/lint-staged/commitlint 依赖 + prepare 脚本 | git-hooks                            |
| **修改** | `server/package.json`                                  | 新增 `@sentry/node`、`@nestjs/terminus`               | error-tracking, app-containerization |
| **修改** | `server/src/main.ts`                                   | Sentry 初始化 + health 模块                           | error-tracking, app-containerization |
| **修改** | `server/.env.example`                                  | 新增 `GLITCHTIP_DSN`                                  | error-tracking                       |
| **修改** | `server/src/app.module.ts`                             | 注册 HealthModule                                     | app-containerization                 |
| **修改** | `client/package.json`                                  | 新增 `@sentry/angular`                                | error-tracking                       |
| **修改** | `client/src/main.ts`                                   | Sentry 初始化                                         | error-tracking                       |
| **修改** | `client/src/environments/environment.ts`               | 新增 `glitchtipDsn` 字段                              | error-tracking                       |
| **修改** | `client/src/environments/environment.prod.ts`          | 新增 `glitchtipDsn` 字段                              | error-tracking                       |
| **新增** | `client/src/app/user-menu/user-menu.component.spec.ts` | 组件测试                                              | client-testing                       |
| **新增** | `client/src/app/chat/chat.component.spec.ts`           | 组件测试                                              | client-testing                       |

## API Contract

### Health Check Endpoint

```
GET /api/health

Response 200:
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up"
    }
  },
  "error": {},
  "details": {
    "database": {
      "status": "up"
    }
  }
}

Response 503:
{
  "status": "error",
  "info": {},
  "error": {
    "database": {
      "status": "down"
    }
  },
  "details": {
    "database": {
      "status": "down"
    }
  }
}
```

## Risks / Trade-offs

| 风险                                           | 影响                                       | 缓解措施                                                  |
| ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Docker 构建上下文过大（monorepo）              | 构建慢，镜像大                             | 使用 `.dockerignore` 排除 node_modules、.git、dist 等     |
| pnpm workspace 依赖安装                        | CI 和 Docker 中需要 workspace 协议正确解析 | 使用 `--frozen-lockfile` 并确保 lockfile 同步             |
| GlitchTip 与 @sentry/angular 版本兼容          | API 差异导致初始化失败                     | 使用 Sentry SDK v9（最新稳定版），已验证 Angular 模式正常 |
| Client 测试因 Angular TestBed + jsdom 组合问题 | 部分 Angular API 在 jsdom 中不可用         | test-setup.ts 已 mock localStorage；其他 API 按需 mock    |
| Claude Code hooks 与 Husky 并存                | 重复格式化和 lint                          | lint-staged 仅处理暂存文件，已格式化过的文件不会重复修改  |

## Migration Plan

1. **无破坏性变更** — 所有新增内容与现有代码并存
2. **逐步启用**：
   - Day 1: 合并 CI workflow + Husky hooks（立即生效）
   - Day 1: 合并 Dockerfile + 健康检查（不强制使用）
   - Day 1: 合并客户端测试（CI 中自动运行）
   - Day 2: docker-compose 启动 GlitchTip → 创建项目 → 配置 DSN → 验证错误上报
3. **回滚**: 删除对应文件即可，不涉及数据迁移

## Open Questions

_所有关键决策已在 grill-me 阶段确认。_

## Known Limitations（来自 Spec Hardener 反向 Grill）

- **Docker 构建依赖根 `pnpm-lock.yaml`**：当 monorepo 新增 workspace 包时，Dockerfile 的 COPY 指令可能需要调整上下文范围。当前仅复制 `server/` 和 `client/`，新增包需手动更新 Dockerfile
- **GlitchTip 版本锁定**：使用 `glitchtip/glitchtip:6`（GlitchTip 6 大版本），跨大版本升级前需验证 Sentry SDK 兼容性和数据迁移路径
- **Client 测试依赖自定义 Vite 插件**：`vitest.config.ts` 中的 `templateUrl` 内联插件依赖 Angular 内部编译 API，Angular 大版本升级（如 22+）可能破坏该插件
- **健康检查范围有限**：当前仅检查数据库连接。未来若新增 Redis/ClickHouse 等运行时依赖，健康检查可能产生假阳性（服务"健康"但部分功能不可用）
- **CI 并行粒度为 server/client 级别**：若 monorepo 包数量增长（如拆分 shared lib），当前 matrix 策略可能不足以快速失败定位
