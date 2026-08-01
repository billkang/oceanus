# cluster-mode Specification

## Purpose

Oceanus 后端 Cluster 多进程能力：通过 Node.js 原生 cluster 模块按 CPU 核心数 fork Worker 进程，支持优雅退出、Worker 意外退出自动重启与健康检查。

## Requirements

### Requirement: Cluster 模式启动

系统 SHALL 在 `main.ts` 中使用 Node.js 原生 `cluster` 模块，根据 CPU 核心数 fork Worker 进程。

#### Scenario: 主进程启动

- **WHEN** Node.js 进程启动且 `CLUSTER_ENABLED=true`
- **THEN** 当前进程作为 Master 进程运行
- **THEN** Master 根据 `os.cpus().length` 数量 fork Worker 进程
- **THEN** Master 不处理 HTTP 请求，仅负责 Worker 生命周期管理
- **THEN** Master 监听 Worker 的 exit 事件，Worker 意外退出时自动重启

#### Scenario: Worker 进程处理请求

- **WHEN** Worker 进程启动
- **THEN** Worker 创建 NestJS 应用实例，监听端口
- **THEN** Worker 之间通过 Master 内置的 round-robin 分发请求（默认行为）

#### Scenario: 单进程降级

- **WHEN** `CLUSTER_ENABLED=false` 或未设置
- **THEN** 系统按单进程模式运行（当前行为不改变）
- **THEN** 不影响任何功能

### Requirement: Worker 优雅退出

系统 SHALL 在接收到终止信号时优雅关闭所有 Worker。

#### Scenario: 收到 SIGTERM/SIGINT

- **WHEN** Master 收到 SIGTERM 或 SIGINT
- **THEN** Master 向所有 Worker 发送 shutdown 信号
- **THEN** Worker 关闭 HTTP 服务器（停止接收新请求）
- **THEN** Worker 等待当前活跃请求完成（超时 `WORKER_SHUTDOWN_TIMEOUT` 默认 30 秒；Rationale：30 秒覆盖绝大多数 LLM 请求的最长响应时间；超过 30 秒的请求直接断开，客户端侧会自动重连）
- **THEN** Worker 退出
- **THEN** Master 在所有 Worker 退出后退出

#### Scenario: Worker 意外退出自动重启

- **WHEN** Worker 因未捕获异常崩溃
- **THEN** Master 监听 Worker exit 事件
- **THEN** Master fork 一个新的 Worker 替代崩溃的 Worker
- **THEN** 系统日志记录 Worker 重启事件
- **THEN** 重启次数超过 `MAX_WORKER_RESTARTS`（默认 5 次/分钟）时 Master 退出

### Requirement: Cluster 下健康检查

系统 SHALL 在 Cluster 模式下健康检查端点仍然正常响应。

#### Scenario: 健康检查返回 Worker 状态

- **WHEN** Master 进程收到 `GET /api/v1/health` 请求
- **THEN** 响应中包含活跃 Worker 数量
- **THEN** 响应中包含预期 Worker 数量（CPU 核心数）
