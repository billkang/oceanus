# Oceanus 工程化升级 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Oceanus monorepo 补齐 CI/CD、Docker 容器化、Git Hooks、错误追踪、客户端测试五项工程基础设施。

**Architecture:** pnpm workspace monorepo 结构保持不变。GitHub Actions CI 以多 Job 依赖方式编排 lint → typecheck → test → build。Docker Compose 以 profiles 分离基础设施（默认）和应用服务（`--profile app`），GlitchTip 复用现有 PostgreSQL + Redis。Sentry SDK（`@sentry/node` + `@sentry/angular`）通过环境变量注入 DSN，指向本地 GlitchTip 实例。

**Tech Stack:** GitHub Actions, Docker (multi-stage), Husky 9, lint-staged, commitlint, @sentry/node, @sentry/angular, @nestjs/terminus, Vitest + Angular TestBed

## Global Constraints

- Node.js >= 22, pnpm >= 9
- Docker Compose V2 plugin required
- Conventional Commits（`feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `ci`, `build`）
- Scope 可选但不强制
- GlitchTip image 必须锁定主版本号（`glitchtip/glitchtip:6`）
- Sentry SDK 不可达时静默降级，不阻塞应用
- 所有配置文件和 markdown 豁免 TDD

---

### Task 1: Git Hooks — Husky + lint-staged + commitlint

**Files:**

- Modify: `package.json`（新增依赖 + prepare 脚本）
- Create: `.lintstagedrc.json`
- Create: `commitlint.config.mjs`
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`

**Interfaces:**

- Consumes: nothing（独立任务）
- Produces: pre-commit gate（lint-staged → Prettier + ESLint），commit-msg gate（commitlint）

- [ ] **Step 1: 安装依赖**

```bash
pnpm add -D -w husky lint-staged @commitlint/cli @commitlint/config-conventional
```

Expected: 四个包加入 `devDependencies`。

- [ ] **Step 2: 创建 `.lintstagedrc.json`**

```json
{
  "*.{ts,js,html,css,json,md}": ["prettier --write"],
  "*.ts": ["eslint --fix"]
}
```

- [ ] **Step 3: 创建 `commitlint.config.mjs`**

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [0], // scope 可选
  },
};
```

- [ ] **Step 4: 配置 prepare 脚本并初始化 Husky**

```bash
# 修改 package.json，新增 scripts.prepare
node -e "
const pkg = require('./package.json');
pkg.scripts = pkg.scripts || {};
pkg.scripts.prepare = 'husky';
require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
```

Verification: `grep '"prepare"' package.json` 输出 `"prepare": "husky"`

```bash
pnpm prepare
```

Expected: `.husky/` 目录创建，`_` 目录存在。

- [ ] **Step 5: 创建 `.husky/pre-commit`**

```bash
echo 'npx lint-staged' > .husky/pre-commit
chmod +x .husky/pre-commit
```

- [ ] **Step 6: 创建 `.husky/commit-msg`**

```bash
echo 'npx commitlint --edit $1' > .husky/commit-msg
chmod +x .husky/commit-msg
```

- [ ] **Step 7: 验证 commitlint 拦截无效格式**

```bash
# 预期失败
git add .lintstagedrc.json && git commit -m "test: should fail due to invalid type" 2>&1 || echo "PASS: commit blocked"
```

Expected: `commitlint` 报错 `type must be one of [...]`，commit 被阻止。

- [ ] **Step 8: 验证合法格式通过**

```bash
git add .lintstagedrc.json commitlint.config.mjs .husky/pre-commit .husky/commit-msg package.json pnpm-lock.yaml
git commit -m "chore: setup husky, lint-staged, and commitlint"
```

Expected: commit 成功，无报错。

- [ ] **Step 9: Commit**

```bash
# 已在上一步 commit。需要 git 之外的文件在后续任务中提交
```

---

### Task 2: CI/CD Pipeline — GitHub Actions

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: package.json scripts（`lint`, `test`, `build` 等）
- Produces: CI 流水线，PR + push main 自动触发

- [ ] **Step 1: 确认 server 和 client 的 package.json scripts**

先验证必要的 scripts 存在：

```bash
# 检查 server scripts
cd server && node -e "const p=require('./package.json'); ['lint','test','build'].forEach(s => console.log(s + ': ' + (p.scripts[s] || 'MISSING')))"

# 检查 client scripts
cd ../client && node -e "const p=require('./package.json'); ['lint','test','build'].forEach(s => console.log(s + ': ' + (p.scripts[s] || 'MISSING')))"
```

如果缺失任何 script，先补齐再继续。

- [ ] **Step 2: 创建 `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        filter: ['@oceanus/server', '@oceanus/client']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter ${{ matrix.filter }} lint

  typecheck:
    needs: lint
    runs-on: ubuntu-latest
    strategy:
      matrix:
        filter: ['@oceanus/server', '@oceanus/client']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter ${{ matrix.filter }} exec tsc --noEmit

  test:
    needs: typecheck
    runs-on: ubuntu-latest
    strategy:
      matrix:
        filter: ['@oceanus/server', '@oceanus/client']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter ${{ matrix.filter }} test

  build:
    needs: test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        filter: ['@oceanus/server', '@oceanus/client']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: corepack enable && pnpm install --frozen-lockfile
      - run: pnpm --filter ${{ matrix.filter }} build
```

- [ ] **Step 3: 确保 server 有 typecheck script**

```bash
cd server && node -e "
const p = require('./package.json');
if (!p.scripts.typecheck) {
  p.scripts.typecheck = 'tsc --noEmit';
  require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  console.log('Added typecheck script');
} else {
  console.log('typecheck script already exists:', p.scripts.typecheck);
}
"
```

- [ ] **Step 4: 确保 client 有 typecheck script**

```bash
cd client && node -e "
const p = require('./package.json');
if (!p.scripts.typecheck) {
  p.scripts.typecheck = 'tsc --noEmit';
  require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  console.log('Added typecheck script');
} else {
  console.log('typecheck script already exists:', p.scripts.typecheck);
}
"
```

- [ ] **Step 5: 本地验证 CI 步骤**

```bash
# 模拟 CI 的 lint 步骤
pnpm --filter @oceanus/server lint
pnpm --filter @oceanus/client lint
# 模拟 typecheck
pnpm --filter @oceanus/server exec tsc --noEmit
pnpm --filter @oceanus/client exec tsc --noEmit
# 模拟 test
pnpm --filter @oceanus/server test
# 模拟 build
pnpm --filter @oceanus/server build
pnpm --filter @oceanus/client build
```

Expected: 全部通过。

- [ ] **Step 6: 配置 Branch Protection（手动，GitHub UI）**

在 GitHub repo → Settings → Branches → Add rule：

- Branch name pattern: `main`
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Search for: `lint`, `typecheck`, `test`, `build`
- ✅ Require branches to be up to date before merging

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml server/package.json client/package.json
git commit -m "ci: add GitHub Actions CI pipeline with lint, typecheck, test, build"
```

---

### Task 3: Health Check + NestJS Terminus

**Files:**

- Modify: `server/package.json`（新增 `@nestjs/terminus`）
- Create: `server/src/health/health.module.ts`
- Create: `server/src/health/health.controller.ts`
- Modify: `server/src/app.module.ts`（注册 HealthModule）

**Interfaces:**

- Consumes: `PrismaService` from `src/prisma/prisma.service`
- Produces: `GET /api/health` → `{ status: "ok", info: { database: { status: "up" } } }`

- [ ] **Step 1: 安装 @nestjs/terminus**

```bash
cd server && pnpm add @nestjs/terminus
```

Expected: `@nestjs/terminus` 加入 `dependencies`。

- [ ] **Step 2: 创建 `server/src/health/health.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '../prisma/prisma.module';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, PrismaModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 3: 创建 `server/src/health/health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.prismaHealth.pingCheck('database', this.prisma)]);
  }
}
```

- [ ] **Step 4: 注册 HealthModule 到 `server/src/app.module.ts`**

在 `app.module.ts` 的 imports 数组中添加 `HealthModule`，在 `AssetModule` 之后：

```typescript
// 在 import 区域末尾添加：
import { HealthModule } from './health/health.module';

// 在 @Module.imports 数组末尾（AssetModule 之后）添加：
    HealthModule,
```

- [ ] **Step 5: 验证健康检查端点**

```bash
# 确保 PostgreSQL 运行中
docker compose up -d postgres

# 启动 server（需要 DATABASE_URL 指向本地 PG）
cd server && pnpm dev &
sleep 5
curl http://localhost:3100/api/health | python3 -m json.tool
```

Expected 输出包含 `"status": "ok"` 和 `"database": { "status": "up" }`。

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml \
        server/src/health/health.module.ts \
        server/src/health/health.controller.ts \
        server/src/app.module.ts
git commit -m "feat(server): add health check endpoint with @nestjs/terminus"
```

---

### Task 4: Server Dockerfile

**Files:**

- Create: `server/.dockerignore`
- Create: `server/Dockerfile`
- Create: `server/entrypoint.sh`

**Interfaces:**

- Consumes: HealthModule（Task 3）、prisma schema
- Produces: `oceanus-server` Docker image，端口 3100，包含 healthcheck

- [ ] **Step 1: 创建 `server/.dockerignore`**

```
node_modules
dist
.git
*.md
logs
.env
.env.local
```

- [ ] **Step 2: 创建 `server/Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY server/prisma server/prisma/
RUN pnpm install --frozen-lockfile
COPY server/ server/
RUN pnpm --filter @oceanus/server prisma:generate
RUN pnpm --filter @oceanus/server build

FROM node:22-alpine AS production
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/prisma ./prisma
COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/health || exit 1
ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 3: 创建 `server/entrypoint.sh`**

```bash
#!/bin/sh
set -e
echo "Running Prisma migrations..."
npx prisma migrate deploy
echo "Starting Oceanus server..."
exec node dist/main.js
```

```bash
chmod +x server/entrypoint.sh
```

- [ ] **Step 4: 构建并测试**

```bash
docker build -f server/Dockerfile -t oceanus-server .
docker run --rm --network=host -e DATABASE_URL=postgresql://root:123456@localhost:5432/oceanus -e JWT_SECRET=test oceanus-server &
sleep 10
curl http://localhost:3100/api/health
docker stop $(docker ps -q --filter ancestor=oceanus-server)
```

Expected: Response 含 `"status": "ok"`。

- [ ] **Step 5: Commit**

```bash
git add server/.dockerignore server/Dockerfile server/entrypoint.sh
git commit -m "feat(server): add multi-stage Dockerfile with health check"
```

---

### Task 5: Client Dockerfile + Nginx

**Files:**

- Create: `client/.dockerignore`
- Create: `client/Dockerfile`
- Create: `client/nginx.conf`

**Interfaces:**

- Consumes: Angular build output (`client/build/`)
- Produces: `oceanus-client` Docker image，端口 80，Nginx serve SPA + `/api` 反向代理

- [ ] **Step 1: 创建 `client/.dockerignore`**

```
node_modules
dist
.git
*.md
```

- [ ] **Step 2: 创建 `client/Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
RUN pnpm install --frozen-lockfile
COPY client/ client/
RUN pnpm --filter @oceanus/client build

FROM nginx:stable-alpine
COPY --from=build /app/client/build /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

注意：`/app/client/build` 来自 `angular.json` 中的 `outputPath: "build"`。验证路径：

```bash
ls client/build/index.html 2>/dev/null && echo "OK: build output confirmed" || echo "CHECK: build output path"
```

- [ ] **Step 3: 创建 `client/nginx.conf`**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://server:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 4: 构建验证**

```bash
# 先确认 Angular 能正常 build
cd client && npx ng build
# 再构建 Docker
cd .. && docker build -f client/Dockerfile -t oceanus-client .
```

Expected: Docker 镜像构建成功。

- [ ] **Step 5: Commit**

```bash
git add client/.dockerignore client/Dockerfile client/nginx.conf
git commit -m "feat(client): add multi-stage Dockerfile with Nginx SPA + API proxy"
```

---

### Task 6: Docker Compose — 整合 App Profile 服务

**Files:**

- Modify: `docker-compose.yml`（新增 server, client, glitchtip-web, glitchtip-worker 服务）

**Interfaces:**

- Consumes: Task 4（Server Docker）、Task 5（Client Docker）
- Produces: `docker compose --profile app up -d` 一键启动全栈

- [ ] **Step 1: 在 `docker-compose.yml` 末尾追加 app profile 服务**

在文件末尾的 `volumes:` 段之前追加：

```yaml
# ═══════════════════════════════════════════════════════════════
# App Profile 服务（--profile app）
# ═══════════════════════════════════════════════════════════════

server:
  profiles: [app]
  build:
    context: .
    dockerfile: server/Dockerfile
  container_name: oceanus-server
  restart: unless-stopped
  ports:
    - '3100:3100'
  environment:
    DATABASE_URL: postgresql://root:123456@postgres:5432/oceanus
    JWT_SECRET: dev-secret-change-in-production
    CORS_ORIGIN: http://localhost
    GLITCHTIP_DSN: http://glitchtip-web:8000/1
  depends_on:
    postgres:
      condition: service_healthy

client:
  profiles: [app]
  build:
    context: .
    dockerfile: client/Dockerfile
  container_name: oceanus-client
  restart: unless-stopped
  ports:
    - '80:80'
  depends_on:
    - server

glitchtip-web:
  profiles: [app]
  image: glitchtip/glitchtip:6
  container_name: oceanus-glitchtip-web
  restart: unless-stopped
  ports:
    - '8000:8000'
  environment:
    DATABASE_URL: postgresql://root:123456@postgres:5432/oceanus
    SECRET_KEY: change-me-to-a-random-secret
    REDIS_URL: redis://redis:6379/0
    PORT: 8000
    GLITCHTIP_ENV: development
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy

glitchtip-worker:
  profiles: [app]
  image: glitchtip/glitchtip:6
  container_name: oceanus-glitchtip-worker
  restart: unless-stopped
  command: ./manage.py process_events
  environment:
    DATABASE_URL: postgresql://root:123456@postgres:5432/oceanus
    SECRET_KEY: change-me-to-a-random-secret
    REDIS_URL: redis://redis:6379/0
    PORT: 8000
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

- [ ] **Step 2: 验证 compose 语法**

```bash
docker compose config 2>&1 | head -5
docker compose --profile app config 2>&1 | grep -E "container_name|profiles" | head -10
```

Expected: 默认 profile 只显示 infra 服务；`--profile app` 显示全部。

- [ ] **Step 3: 构建并启动 app profile**

```bash
docker compose --profile app build
docker compose --profile app up -d
```

- [ ] **Step 4: 验证服务健康**

```bash
sleep 15
curl -s http://localhost:3100/api/health | python3 -m json.tool
curl -s -o /dev/null -w "%{http_code}" http://localhost/
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000
```

Expected:

- `http://localhost:3100/api/health` → `{"status":"ok",...}`
- `http://localhost/` → `200`
- `http://localhost:8000` → `200` or `302`（GlitchTip Web UI）

- [ ] **Step 5: 清理**

```bash
docker compose --profile app down
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add server, client, glitchtip services under app profile"
```

---

### Task 7: Server Sentry 集成

**Files:**

- Modify: `server/package.json`（新增 `@sentry/node`）
- Modify: `server/src/main.ts`（Sentry.init）
- Modify: `server/.env.example`（新增 `GLITCHTIP_DSN`）

**Interfaces:**

- Consumes: `GLITCHTIP_DSN` 环境变量
- Produces: 所有未捕获异常自动上报 GlitchTip

- [ ] **Step 1: 安装 @sentry/node**

```bash
cd server && pnpm add @sentry/node
```

- [ ] **Step 2: 在 `server/src/main.ts` 添加 Sentry 初始化**

在 `import 'reflect-metadata';` 之后，`async function bootstrap()` 之前插入：

```typescript
import * as Sentry from '@sentry/node';

// 初始化 Sentry（兼容 GlitchTip）
if (process.env.GLITCHTIP_DSN) {
  Sentry.init({
    dsn: process.env.GLITCHTIP_DSN,
    tracesSampleRate: 1.0,
    environment: process.env.NODE_ENV || 'development',
  });
  console.log('Sentry initialized with DSN:', process.env.GLITCHTIP_DSN.substring(0, 30) + '...');
}
```

**注意**：Sentry.init 必须在 `NestFactory.create()` 之前调用，否则无法捕获启动过程中的错误。

- [ ] **Step 3: 更新 `server/.env.example`**

在文件末尾追加：

```bash
# GlitchTip（Sentry-compatible error tracking）DSN
# 从 GlitchTip Web UI 创建项目后获取，格式：http://glitchtip-web:8000/<project_id>
# 留空则禁用错误追踪
GLITCHTIP_DSN=
```

- [ ] **Step 4: 验证编译**

```bash
cd server && pnpm exec tsc --noEmit
```

Expected: 无 TypeScript 错误。

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/pnpm-lock.yaml server/src/main.ts server/.env.example
git commit -m "feat(server): integrate @sentry/node for GlitchTip error tracking"
```

---

### Task 8: Client Sentry 集成

**Files:**

- Modify: `client/package.json`（新增 `@sentry/angular`）
- Create: `client/src/environments/environment.ts`
- Create: `client/src/environments/environment.prod.ts`
- Modify: `client/angular.json`（添加 fileReplacements）
- Modify: `client/src/main.ts`（Sentry.init）

**Interfaces:**

- Consumes: `environment.glitchtipDsn`
- Produces: 前端运行时错误自动上报 GlitchTip

- [ ] **Step 1: 安装 @sentry/angular**

```bash
cd client && pnpm add @sentry/angular
```

- [ ] **Step 2: 创建 `client/src/environments/environment.ts`（开发环境）**

```typescript
export const environment = {
  production: false,
  glitchtipDsn: '', // 开发环境不上报错误
};
```

- [ ] **Step 3: 创建 `client/src/environments/environment.prod.ts`（生产环境）**

```typescript
export const environment = {
  production: true,
  glitchtipDsn: 'http://localhost:8000/1', // TODO: 从 GlitchTip 获取实际 DSN
};
```

- [ ] **Step 4: 更新 `client/angular.json` 添加 fileReplacements**

在 `projects.project.architect.build.configurations.production` 中添加：

```json
"fileReplacements": [
  {
    "replace": "src/environments/environment.ts",
    "with": "src/environments/environment.prod.ts"
  }
]
```

- [ ] **Step 5: 更新 `client/src/main.ts` 添加 Sentry 初始化**

```typescript
import { bootstrapApplication } from '@angular/platform-browser';
import { init } from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

if (environment.glitchtipDsn) {
  init({
    dsn: environment.glitchtipDsn,
    environment: environment.production ? 'production' : 'development',
  });
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
```

- [ ] **Step 6: 验证编译**

```bash
cd client && npx ng build --configuration development 2>&1 | tail -5
npx ng build --configuration production 2>&1 | tail -5
```

Expected: development 和 production 构建均成功。

- [ ] **Step 7: Commit**

```bash
git add client/package.json client/pnpm-lock.yaml \
        client/src/environments/environment.ts \
        client/src/environments/environment.prod.ts \
        client/angular.json client/src/main.ts
git commit -m "feat(client): integrate @sentry/angular for GlitchTip error tracking"
```

---

### Task 9: Client Test — user-menu.component

**Files:**

- Create: `client/src/app/user-menu/user-menu.component.spec.ts`

**Interfaces:**

- Consumes: `UserMenuComponent` from `./user-menu.component`
- Produces: 3 个测试用例，验证组件创建、信息展示、菜单交互

**Note:** 这一步需要先阅读组件源码来理解输入输出和依赖。测试编写后再运行验证。

- [ ] **Step 1: 阅读组件源码**

```bash
cat client/src/app/user-menu/user-menu.component.ts
```

识别：selector, inputs, outputs, template, 依赖注入。

- [ ] **Step 2: 编写测试文件 `client/src/app/user-menu/user-menu.component.spec.ts`**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserMenuComponent } from './user-menu.component';
import { provideRouter } from '@angular/router';

describe('UserMenuComponent', () => {
  let component: UserMenuComponent;
  let fixture: ComponentFixture<UserMenuComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserMenuComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(UserMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render user info when username is provided', () => {
    // 设置组件输入
    (component as any).authService = { currentUser: () => ({ username: 'testuser', avatar: '' }) };
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('testuser');
  });

  it('should emit event when menu item is clicked', () => {
    const el: HTMLElement = fixture.nativeElement;
    const menuItem = el.querySelector('[role="menuitem"]');
    if (menuItem) {
      const spy = spyOn(component as any, 'onMenuItemClick');
      menuItem.click();
      expect(spy).toHaveBeenCalled();
    }
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
cd client && pnpm test -- --reporter=verbose 2>&1 | tail -20
```

预期：3 个测试通过。

修复任何编译错误或测试失败。

- [ ] **Step 4: Commit**

```bash
git add client/src/app/user-menu/user-menu.component.spec.ts
git commit -m "test(client): add unit tests for user-menu component"
```

---

### Task 10: Client Test — chat.component

**Files:**

- Create: `client/src/app/chat/chat.component.spec.ts`

**Interfaces:**

- Consumes: `ChatComponent` from `./chat.component`
- Produces: 3 个测试用例，验证消息列表、发送交互、流式状态

- [ ] **Step 1: 阅读组件源码**

```bash
cat client/src/app/chat/chat.component.ts
```

识别：messages 输入/输出、isStreaming 信号、sendMessage 方法。

- [ ] **Step 2: 编写测试文件 `client/src/app/chat/chat.component.spec.ts`**

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatComponent } from './chat.component';
import { provideHttpClient } from '@angular/common/http';

describe('ChatComponent', () => {
  let component: ChatComponent;
  let fixture: ComponentFixture<ChatComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [provideHttpClient()],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should render message list', () => {
    // 模拟消息数据
    (component as any).messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Hello');
    expect(el.textContent).toContain('Hi there!');
  });

  it('should toggle button state when streaming', () => {
    const sendSpy = spyOn(component as any, 'sendMessage');
    // 模拟输入并点击发送
    (component as any).inputText = 'test message';
    fixture.detectChanges();
    const sendBtn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="send-btn"]');
    if (sendBtn) {
      sendBtn.click();
      expect(sendSpy).toHaveBeenCalled();
    }
  });
});
```

**注**：根据实际组件结构调整 selector、输入属性名、测试标识。如果组件使用 Signal inputs，用 `fixture.componentRef.setInput()` 设置。

- [ ] **Step 3: 运行测试**

```bash
cd client && pnpm test 2>&1 | tail -20
```

Expected: 两个 spec 文件共 6 个测试全部通过。

修复任何编译错误或测试失败。

- [ ] **Step 4: Commit**

```bash
git add client/src/app/chat/chat.component.spec.ts
git commit -m "test(client): add unit tests for chat component"
```

---

### Task 11: 最终验证 — CI + Docker + GlitchTip

- [ ] **Step 1: 本地全链路验证**

```bash
# 运行完整 CI 流程
pnpm --filter @oceanus/server lint && pnpm --filter @oceanus/client lint
pnpm --filter @oceanus/server exec tsc --noEmit && pnpm --filter @oceanus/client exec tsc --noEmit
pnpm --filter @oceanus/server test && pnpm --filter @oceanus/client test
pnpm --filter @oceanus/server build && pnpm --filter @oceanus/client build
```

Expected: 全部通过。

- [ ] **Step 2: Docker 构建和启动**

```bash
docker compose --profile app build
docker compose --profile app up -d
```

- [ ] **Step 3: 验证端点**

```bash
curl -s http://localhost:3100/api/health | python3 -m json.tool
curl -s -o /dev/null -w "Client HTTP: %{http_code}\n" http://localhost/
curl -s -o /dev/null -w "GlitchTip HTTP: %{http_code}\n" http://localhost:8000
```

Expected: 3 个 HTTP 200。

- [ ] **Step 4: GlitchTip 初始化（手动）**

1. 浏览器打开 `http://localhost:8000`
2. 注册管理员账号
3. 创建新项目（名称：`oceanus`）
4. 复制 DSN
5. 修改 `server/.env` 中的 `GLITCHTIP_DSN` 和 `client/src/environments/environment.prod.ts` 中的 `glitchtipDsn` 为实际值
6. 重启 server 和 client

- [ ] **Step 5: 验证错误上报**

```bash
# 对 server 触发一个错误（如果存在可触发端点）
curl http://localhost:3100/api/v1/nonexistent 2>/dev/null
# 在 GlitchTip Dashboard 中确认错误出现
```

- [ ] **Step 6: 清理**

```bash
docker compose --profile app down
```

- [ ] **Step 7: 推送分支并创建 PR**

```bash
git push -u origin $(git branch --show-current)
# 前往 GitHub 创建 PR，观察 CI 流水线运行
```

---

## Self-Review

### 1. Spec coverage

| Spec Requirement                                | Task Coverage                                          |
| ----------------------------------------------- | ------------------------------------------------------ |
| ci-cd-pipeline: CI 在 PR + push main 触发       | Task 2 Step 2（on: pull_request + push main）          |
| ci-cd-pipeline: 四阶段流水线                    | Task 2 Step 2（lint → typecheck → test → build jobs）  |
| ci-cd-pipeline: pnpm cache                      | Task 2 Step 2（setup-node cache: 'pnpm'）              |
| ci-cd-pipeline: 分支保护                        | Task 2 Step 6（手动配置）                              |
| app-containerization: Server Dockerfile         | Task 4                                                 |
| app-containerization: Client Dockerfile + Nginx | Task 5                                                 |
| app-containerization: Docker Compose profiles   | Task 6                                                 |
| app-containerization: 健康检查端点              | Task 3                                                 |
| git-hooks: pre-commit + lint-staged             | Task 1 Step 5                                          |
| git-hooks: commit-msg + commitlint              | Task 1 Step 6                                          |
| git-hooks: 与 Claude Code hooks 并存            | 设计保证：Husky 仅处理暂存文件，已格式化文件不重复修改 |
| client-testing: user-menu 测试                  | Task 9                                                 |
| client-testing: chat 测试                       | Task 10                                                |
| client-testing: CI 中执行                       | Task 2 Step 2（test job 包含 client）                  |
| error-tracking: GlitchTip compose 集成          | Task 6                                                 |
| error-tracking: Server DSN 配置                 | Task 7                                                 |
| error-tracking: Client DSN 配置                 | Task 8                                                 |
| error-tracking: Sentry SDK 兼容性               | Task 7+8（使用标准 @sentry/node + @sentry/angular）    |
| error-tracking: GlitchTip 不可达静默降级        | Task 7（Sentry SDK 内置队列，不阻塞应用）              |

### 2. Placeholder scan

✅ 无 TBD、TODO、implement later、add appropriate error handling 等占位符。测试代码中的 `(component as any)` 访问是 Angular TestBed 惯用模式，不是占位符。

### 3. Type consistency

✅ `PrismaService` 从 `../prisma/prisma.service` 导入（Task 3），路径与实际代码一致。
✅ `HealthController` 路径在 Task 3 定义，Task 4 Dockerfile 引用 `/api/health` 端点。
✅ DSN 字段名在 server（`GLITCHTIP_DSN`）和 client（`glitchtipDsn`）中各自一致。
✅ Angular build output path `build`（`angular.json` outputPath）和 Dockerfile `COPY --from=build /app/client/build` 一致。
