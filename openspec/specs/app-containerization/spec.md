# App Containerization

## Purpose

提供 Docker 容器化方案，使 Server 和 Client 能够在容器化环境中运行，支持 Docker Compose 编排和 profile 分离。

## Requirements

### Requirement: Server 有生产级 Dockerfile

Server SHALL 提供 multi-stage Dockerfile，构建阶段完成 Prisma Client 生成和 NestJS 编译，运行阶段仅包含生产依赖和构建产物。

#### Scenario: Server Docker 镜像构建成功

- **WHEN** 在项目根目录执行 `docker build -f server/Dockerfile -t oceanus-server .`
- **THEN** 系统成功构建出包含生产 dist/ 和 node_modules 的轻量镜像

#### Scenario: Server 容器健康检查通过

- **WHEN** Server 容器启动
- **THEN** Docker healthcheck 通过 `/api/health` 端点确认服务就绪

### Requirement: Client 有 Nginx-based Dockerfile

Client SHALL 提供 Dockerfile，构建阶段完成 Angular 生产构建，运行阶段使用 Nginx serve 静态文件并反向代理 API 请求。

#### Scenario: Client Docker 镜像构建成功

- **WHEN** 在项目根目录执行 `docker build -f client/Dockerfile -t oceanus-client .`
- **THEN** 系统成功构建出 Nginx + Angular 构建产物的镜像

#### Scenario: Nginx 反向代理 API 请求

- **WHEN** 浏览器通过 Client 容器访问 `/api/*` 路径
- **THEN** Nginx 将该请求代理转发到 Server 容器（`http://server:3100`）

#### Scenario: Nginx 正确 serve Angular SPA

- **WHEN** 浏览器访问 Client 容器任意非 `/api/*` 路径
- **THEN** Nginx 返回 Angular 构建的静态文件，fallback 到 `index.html` 支持 SPA 路由

### Requirement: Docker Compose 支持 profile 区分 infra 和 app

docker-compose.yml SHALL 使用 Docker Compose profiles 将基础设施服务与应用服务分离，默认只启动基础设施。

#### Scenario: 默认启动仅 infra

- **WHEN** 执行 `docker compose up -d`
- **THEN** 仅启动 PostgreSQL、Redis、ClickHouse、MinIO、Langfuse 等基础设施服务

#### Scenario: app profile 启动全栈

- **WHEN** 执行 `docker compose --profile app up -d`
- **THEN** 额外启动 server、client、glitchtip-web、glitchtip-worker 服务

### Requirement: Server 提供健康检查端点

Server SHALL 暴露 `/api/health` 端点用于 Docker healthcheck 和负载均衡健康探测。

#### Scenario: 健康检查返回正常状态

- **WHEN** 服务运行正常且数据库连接可用
- **THEN** `GET /api/health` 返回 HTTP 200，body 包含 `{ status: "ok" }`

#### Scenario: 健康检查返回异常状态

- **WHEN** 服务运行但数据库连接不可用
- **THEN** `GET /api/health` 返回 HTTP 503，body 包含错误信息
