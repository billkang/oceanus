# Spec: Log Level Config

## Requirements

### Requirement: LOG_LEVEL 环境变量

系统 SHALL 通过 `LOG_LEVEL` 环境变量控制 Pino 日志输出级别，取代当前的 `NODE_ENV` 硬编码方式。

#### Scenario: LOG_LEVEL 未设置时开发环境默认 debug

- **WHEN** `LOG_LEVEL` 未设置，且 `NODE_ENV` 为 `development` 或未设置
- **THEN** Pino 日志输出级别 SHALL 为 `debug`

#### Scenario: LOG_LEVEL 未设置时生产环境默认 info

- **WHEN** `LOG_LEVEL` 未设置，且 `NODE_ENV` 为 `production`
- **THEN** Pino 日志输出级别 SHALL 为 `info`

#### Scenario: LOG_LEVEL 显式设置

- **WHEN** `LOG_LEVEL` 设置为 `warn`
- **THEN** Pino 日志输出级别 SHALL 为 `warn`，忽略 `NODE_ENV` 的默认值

#### Scenario: LOG_LEVEL 不合法值

- **WHEN** `LOG_LEVEL` 设置为不合法值（如 `xyz`）
- **THEN** 系统 SHALL 回退到 `info` 级别
- **THEN** 系统 SHALL 输出一条警告日志说明 level 不合法

### Requirement: Pino 生产环境输出目标改为 stdout

系统 SHALL 将 Pino 生产环境的输出目标从 `./logs/combined.log` 文件改为 stdout。

#### Scenario: 生产环境日志写入 stdout

- **WHEN** `NODE_ENV` 为 `production`，且 Pino 日志被调用
- **THEN** 日志 SHALL 写入 stdout（fd 1）
- **THEN** 日志 SHALL NOT 写入任何文件

#### Scenario: 开发环境保持 pino-pretty

- **WHEN** `NODE_ENV` 为 `development` 或未设置
- **THEN** 控制台 SHALL 使用 `pino-pretty` 美化输出
- **THEN** 日志 SHALL NOT 写入 `./logs/combined.log`

### Requirement: LOG_LEVEL 配置位置

`LOG_LEVEL` 环境变量 SHALL 在 `server/.env` 和 `server/.env.example` 中声明。

#### Scenario: .env 文件配置

- **WHEN** 开发者打开 `server/.env` 或 `server/.env.example`
- **THEN** SHALL 能找到 `LOG_LEVEL=info` 的默认配置行

#### Scenario: Docker 环境传递

- **WHEN** 容器运行 `oceanus-server`
- **THEN** `LOG_LEVEL` SHALL 从 `server/.env` 传递到容器环境变量中
