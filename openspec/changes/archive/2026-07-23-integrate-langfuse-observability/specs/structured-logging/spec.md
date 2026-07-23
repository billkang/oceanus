## ADDED Requirements

### Requirement: Pino 日志框架
系统 SHALL 使用 `nestjs-pino` 替换 NestJS 默认 Logger（`Logger` from `@nestjs/common`）。
所有 NestJS 内部模块（HTTP、WebSocket、异常过滤器）SHALL 自动使用 Pino 输出。

#### Scenario: 框架初始化日志
- **WHEN** NestJS 应用启动
- **THEN** 日志以 JSON 格式输出，含 `level`、`time`、`pid`、`hostname`、`msg`、`context` 字段

#### Scenario: 原有 Logger 调用兼容
- **WHEN** 代码中调用 `this.logger.log('message')`、`this.logger.warn(...)`、`this.logger.error(...)`
- **THEN** 输出格式为 Pino JSON，而非 NestJS 默认文本格式

### Requirement: 控制台 + 文件双输出
开发环境 SHALL 同时输出到控制台（`pino-pretty` 美化）和文件（纯 JSON）。
staging/prod SHALL 默认输出到文件，控制台按级别控制。

#### Scenario: 开发环境控制台输出
- **WHEN** `NODE_ENV=development` 时应用启动
- **THEN** 控制台日志为彩色可读格式（使用 `pino-pretty`）

#### Scenario: 文件输出
- **WHEN** 任何环境产生日志
- **THEN** Pino 同时写入 `logs/` 目录下的 JSON 文件

### Requirement: 日志目录结构
日志文件 SHALL 存储在 `logs/{projectId}/{sessionId}.log` 路径下。

#### Scenario: 项目会话日志
- **WHEN** 用户在 project `proj-abc` 下的会话 `sess-xyz` 中发送消息
- **THEN** 日志写入 `logs/proj-abc/sess-xyz.log`
- **AND** 该文件包含该会话期间的所有日志事件

### Requirement: 日志级别策略
日志级别按环境区分：

| 环境 | 控制台 | 文件 |
|------|--------|------|
| development | debug | debug |
| staging | info | info |
| production | warn | info |

#### Scenario: 开发环境 debug 日志
- **WHEN** `NODE_ENV=development` 且代码调用 `this.logger.debug('detail')`
- **THEN** 控制台和文件均输出该 debug 消息

#### Scenario: 生产环境控制台不输出 info
- **WHEN** `NODE_ENV=production` 且代码调用 `this.logger.info('routine')`
- **THEN** 文件记录该日志，但控制台不显示

### Requirement: 日志文件不轮转
日志文件 SHALL NOT 按时间或大小轮转。
日志按会话颗粒度分文件，会话结束即停止写入，不存在无限增长问题。

#### Scenario: 长会话日志
- **WHEN** 一个会话持续 24 小时
- **THEN** 所有日志写入同一个 `logs/{projectId}/{sessionId}.log` 文件
- **AND** 不触发文件轮转

### Requirement: .gitignore 处理
`logs/` 目录 SHALL 被加入 `.gitignore`。

#### Scenario: git 忽略日志
- **WHEN** 执行 `git status`
- **THEN** `logs/` 目录下的文件不显示在变更列表中
