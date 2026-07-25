# Error Tracking

## Purpose

使用 GlitchTip（自托管 Sentry 兼容方案）集成前后端错误监控，实现生产环境异常自动上报和集中管理。

## Requirements

### Requirement: GlitchTip 服务集成到 Docker Compose

docker-compose.yml SHALL 新增 GlitchTip Web 和 Worker 服务，复用现有 PostgreSQL 和 Redis，归属于 `app` profile。

#### Scenario: GlitchTip 服务启动

- **WHEN** 执行 `docker compose --profile app up -d`
- **THEN** GlitchTip Web 在 `http://localhost:8000` 可访问，Admin 界面正常显示

#### Scenario: GlitchTip 复用现有基础设施

- **WHEN** GlitchTip 容器启动
- **THEN** GlitchTip 使用 docker-compose 中已有的 PostgreSQL（`postgres:5432`）和 Redis（`redis:6379`），不创建额外数据库实例

### Requirement: Server 通过环境变量配置 GlitchTip DSN

Server SHALL 通过 `GLITCHTIP_DSN` 环境变量配置 Sentry SDK 的 DSN 地址，错误自动上报到 GlitchTip。

#### Scenario: 配置了 DSN 时错误上报

- **WHEN** `.env` 中设置了 `GLITCHTIP_DSN=http://localhost:8000/1`，server 运行中发生未捕获异常
- **THEN** 异常堆栈和上下文自动上报到 GlitchTip，在 GlitchTip Dashboard 中可见

#### Scenario: 未配置 DSN 时静默

- **WHEN** `.env` 中未设置 `GLITCHTIP_DSN` 或值为空
- **THEN** Sentry SDK 不初始化，不尝试上报，不影响应用正常运行

### Requirement: Client 通过 environment 文件配置 GlitchTip DSN

Client SHALL 通过 Angular environment 文件注入 GlitchTip DSN，生产构建时错误自动上报。

#### Scenario: 生产构建上报错误

- **WHEN** Client 以 production 模式构建并运行，`environment.prod.ts` 中配置了 `glitchtipDsn`
- **THEN** 前端运行时异常（含 sourcemap 还原后的堆栈）自动上报到 GlitchTip

#### Scenario: 开发模式禁用上报

- **WHEN** Client 以 development 模式运行，`glitchtipDsn` 为空字符串或 `undefined`
- **THEN** Sentry SDK 跳过初始化，不在开发环境产生噪声上报

### Requirement: 使用 Sentry SDK 兼容 GlitchTip

GlitchTip SHALL 兼容标准 Sentry SDK（`@sentry/node` 用于 NestJS，`@sentry/angular` 或 `@sentry/browser` 用于 Angular），不需要 GlitchTip 专用 SDK。

#### Scenario: NestJS 使用 @sentry/node

- **WHEN** Server 安装 `@sentry/node` 并通过 `Sentry.init({ dsn: process.env.GLITCHTIP_DSN })` 初始化
- **THEN** 错误正常出现在 GlitchTip Dashboard，分组和堆栈解析正常工作

#### Scenario: Angular 使用 @sentry/angular

- **WHEN** Client 安装 `@sentry/angular` 并通过 `Sentry.init({ dsn: environment.glitchtipDsn })` 初始化
- **THEN** 前端错误正常出现在 GlitchTip Dashboard，sourcemap 解析后能定位到源码

#### Scenario: GlitchTip 不可达时静默降级

- **WHEN** GlitchTip 服务不可达或网络中断
- **THEN** Sentry SDK 在本地缓冲事件（默认最多 30 个），不阻塞应用正常运行，不抛出异常
