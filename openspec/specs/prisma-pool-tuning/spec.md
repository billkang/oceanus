## ADDED Requirements

### Requirement: Prisma 连接池显式配置

系统 SHALL 在 PrismaModule 中显式配置 `connection_limit`，替代 Prisma 默认的自动计算值。

#### Scenario: 单进程模式连接池

- **WHEN** 处于单进程模式（`CLUSTER_ENABLED=false`）
- **THEN** Prisma 连接池 `connection_limit` 使用 `PRISMA_CONNECTION_LIMIT`（默认 10）
- **THEN** 连接池可覆盖 PostgreSQL `max_connections`

#### Scenario: Cluster 模式连接池

- **WHEN** 处于 Cluster 模式（n 个 Worker）
- **THEN** 每个 Worker 的 Prisma 连接池 `connection_limit` 使用 `PRISMA_CONNECTION_LIMIT`（默认 4）
- **THEN** 总连接数 = n × 4，不超过 PostgreSQL `max_connections`

#### Scenario: 连接池耗尽

- **WHEN** 所有 Prisma 连接均被占用且新查询到达
- **THEN** Prisma 等待池中的连接释放
- **THEN** 等待超时后抛出错误
- **THEN** 错误被全局异常过滤器捕获，返回 503

### Requirement: 连接池配置验证

系统 SHALL 在启动时验证 Prisma 连接池配置是否在合理范围内。

#### Scenario: 启动时连接数检查

- **WHEN** 系统启动时计算预期总连接数 = CPU 核心数 × `PRISMA_CONNECTION_LIMIT`
- **THEN** 如果预期总连接数 >= PostgreSQL `max_connections` × 0.8
- **THEN** 系统日志输出警告信息
