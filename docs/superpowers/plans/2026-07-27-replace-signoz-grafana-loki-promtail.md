# SigNoz 替换 Grafana/Loki/Promtail 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 SigNoz（Apache 2.0）替换 Grafana + Loki + Promtail（AGPL v3），消除商业许可风险，同时将日志采集方式从文件 tail 升级为 OpenTelemetry 自动插桩。

**Architecture:** 在 docker-compose 中新增 SigNoz 四容器（SigNoz、OTel Collector、ClickHouse、ZooKeeper），移除 Grafana/Loki/Promtail。后端 NestJS 通过 `@opentelemetry/instrumentation-pino` 将日志直接以 OTLP 协议发送到 OTel Collector，自动关联 trace_id。

**Tech Stack:** SigNoz（Apache 2.0）、OpenTelemetry JS SDK、nestjs-pino（无需改动）

## Global Constraints

- SigNoz 使用固定镜像标签，不追 `latest`
- ClickHouse 专用于 SigNoz，与 Langfuse 的 ClickHouse 独立部署
- OTel SDK 初始化代码必须在 `main.ts` 最前面加载（import order 敏感）
- 不改动现有 `logger.info/warn/error` 调用
- Langfuse 不在此变更范围内

---

### Task 1: sigNoz docker-compose 集成

**Files:**

- Modify: `docker-compose.yml`（新增 SigNoz 四容器，移除 Loki/Grafana/Promtail 三容器）
- Delete: `infra/loki/loki-config.yml`
- Delete: `infra/promtail/promtail-config.yml`
- Delete: `infra/grafana/provisioning/`（目录及内容）
- Create: `infra/otel-collector-config.yaml`（复用 SigNoz 官方配置）

**Interfaces:**

- Consumes: 无
- Produces: SigNoz 基础设施就绪，OTel Collector 在 `otel-collector:4318` 监听

- [ ] **Step 1: 复制 OTel Collector 官方配置**

从 SigNoz 官方 repo 复制 `deploy/docker/clickhouse-setup/otel-collector-config.yaml` 到 `infra/otel-collector-config.yaml`。

```bash
# 从 SigNoz GitHub 获取官方配置
curl -o infra/otel-collector-config.yaml \
  https://raw.githubusercontent.com/SigNoz/signoz/main/deploy/docker/clickhouse-setup/otel-collector-config.yaml
```

- [ ] **Step 2: 修改 docker-compose.yml — 移除 Grafana/Loki/Promtail**

在 `docker-compose.yml` 中：

1. 删除 loki 服务定义（含 volumes 引用 `loki_data`）
2. 删除 promtail 服务定义
3. 删除 grafana 服务定义（含 volumes 引用 `grafana_data`）
4. 从 `volumes:` 区块删除 `loki_data:` 和 `grafana_data:`
5. 删除文件注释中提及 Loki/Promtail 的部分

- [ ] **Step 3: 修改 docker-compose.yml — 新增 SigNoz 四容器**

在 `docker-compose.yml` 末尾、`volumes:` 之前新增：

```yaml
# ── SigNoz（日志聚合）─────────────────────────────────────────
signoz:
  image: signoz/signoz:0.113.0
  container_name: oceanus-signoz
  restart: unless-stopped
  ports:
    - '8080:8080'
  depends_on:
    signoz-clickhouse:
      condition: service_healthy
  environment:
    SIGNOZ_CLICKHOUSE_DSN: tcp://signoz-clickhouse:9000

signoz-otel-collector:
  image: signoz/otel-collector:0.113.0
  container_name: oceanus-signoz-otel-collector
  restart: unless-stopped
  ports:
    - '4317:4317' # gRPC
    - '4318:4318' # HTTP
  volumes:
    - ./infra/otel-collector-config.yaml:/etc/otel-collector-config.yaml
  command:
    - --config=/etc/otel-collector-config.yaml
  depends_on:
    signoz-clickhouse:
      condition: service_healthy
  environment:
    SIGNOZ_OTEL_COLLECTOR_CLICKHOUSE_DSN: tcp://signoz-clickhouse:9000

signoz-clickhouse:
  image: clickhouse/clickhouse-server:24.12
  container_name: oceanus-signoz-clickhouse
  restart: unless-stopped
  ulimits:
    nofile:
      soft: 262144
      hard: 262144
  healthcheck:
    test: ['CMD', 'clickhouse-client', '--query', 'SELECT 1']
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
  volumes:
    - signoz_clickhouse_data:/var/lib/clickhouse

signoz-zookeeper:
  image: bitnami/zookeeper:3.9
  container_name: oceanus-signoz-zookeeper
  restart: unless-stopped
  environment:
    ALLOW_ANONYMOUS_LOGIN: 'yes'
```

在 `volumes:` 中新增：

```yaml
signoz_clickhouse_data:
```

- [ ] **Step 4: 删除旧 infra 配置目录**

```bash
rm -rf infra/loki infra/promtail infra/grafana
```

- [ ] **Step 5: 验证启动**

```bash
docker compose up -d
docker compose ps
# 确认 4 个 SigNoz 容器均为 healthy/up
# 确认 Grafana/Loki/Promtail 容器不存在
curl -s http://localhost:8080 | head -1
# Expected: 返回 SigNoz UI 页面内容（非 connection refused）
```

- [ ] **Step 6: 提交**

```bash
git add docker-compose.yml infra/otel-collector-config.yaml
git add -A infra/  # 记录删除
git commit -m "infra: replace Grafana/Loki/Promtail with SigNoz (Apache 2.0)"
```

---

### Task 2: OTel 依赖安装与 SDK 初始化

**Files:**

- Modify: `server/package.json`（新增 3 个 OTel 依赖）
- Create: `server/src/logging-otel.ts`（OTel SDK 初始化代码）
- Modify: `server/src/main.ts`（添加 import）

**Interfaces:**

- Consumes: Task 1 的 OTel Collector 在 `signoz-otel-collector:4318` 可用
- Produces: `logging-otel.ts` 中启动的 OTel SDK 拦截所有 Pino logger 调用，导出到 OTel Collector

- [ ] **Step 1: 安装 OTel 依赖**

```bash
pnpm --filter @oceanus/server add \
  @opentelemetry/sdk-node@^0.208.0 \
  @opentelemetry/exporter-logs-otlp-http@^0.208.0 \
  @opentelemetry/instrumentation-pino@^0.55.0 \
  @opentelemetry/resources@^2.0.0 \
  @opentelemetry/semantic-conventions@^1.30.0
```

- [ ] **Step 2: 创建 `server/src/logging-otel.ts`**

```typescript
/**
 * OpenTelemetry 日志采集初始化
 *
 * 必须作为应用第一个 import 加载（在 main.ts 顶部），
 * 确保所有 Pino logger 调用都被 OTel instrumentation 拦截。
 *
 * 如果 OTel Collector 不可达，SDK 内部排队重试，不阻塞应用启动。
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const OTEL_COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL || 'http://signoz-otel-collector:4318/v1/logs';

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'oceanus-server',
  }),
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter({ url: OTEL_COLLECTOR_URL })),
  instrumentations: [new PinoInstrumentation({})],
});

sdk.start();

// 应用关闭时优雅关闭 SDK
process.on('SIGTERM', () => {
  sdk.shutdown().catch((err) => console.error('OTel SDK shutdown error:', err));
});
```

- [ ] **Step 3: 在 `main.ts` 顶部添加 import**

在 `server/src/main.ts` 中，`import { config } from 'dotenv'` 之后、`import 'reflect-metadata'` 之前添加：

```typescript
// ⚠️ 必须保持在最前加载（import order 敏感）
// 确保 OTel instrumentation 在所有 logger 调用之前就绪
import './logging-otel';
```

最终 `main.ts` import 顺序应为：

```
config(dotenv) → './logging-otel' → 'reflect-metadata' → Sentry → NestJS ...
```

- [ ] **Step 4: 提交**

```bash
git add server/package.json server/src/logging-otel.ts server/src/main.ts
git commit -m "feat: add OTel Pino instrumentation for SigNoz log ingestion"
```

---

### Task 3: 验证端到端日志链路

**Files:** 无（仅验证操作）

**Interfaces:**

- Consumes: Task 1（SigNoz 运行）、Task 2（OTel SDK 已接入）
- Produces: 确认日志链路正常工作

- [ ] **Step 1: 检查 OTel SDK 启动日志**

```bash
docker compose logs server | grep -i "otel\|openTelemetry\|opentelemetry"
# Expected: 无错误日志（SDK 静默启动为正常行为）
```

- [ ] **Step 2: 在 SigNoz UI 中确认日志写入**

1. 访问 `http://localhost:8080`
2. 进入 Logs → Logs Explorer
3. 搜索 `service.name = "oceanus-server"`
4. Expected：日志列表按时间倒序出现，显示 info/warn/error 级别

- [ ] **Step 3: 验证 trace_id 自动关联**

在 `server/src/chat/chat.service.ts` 中临时添加一条日志用于验证（后续可移除）：

```typescript
// 临时验证：某 controller 方法内
this.logger.log({ msg: 'sigNoz-trace-test', chatId: message.id });
```

1. 重启后端：`docker compose restart server`
2. 发送一条聊天消息
3. 在 SigNoz 搜索 `sigNoz-trace-test`
4. 检查该日志记录是否包含 `trace_id` 和 `span_id` 字段
5. 移除临时日志代码

- [ ] **Step 4: 验证 Collector 不可达降级**

```bash
# 停止 Collector，模拟故障
docker stop oceanus-signoz-otel-collector

# 验证后端正常运行
curl -s http://localhost:3100/api/v1/ | head -5
# Expected: 正常返回（可能报指标接口错误，但不 crash）

# 恢复 Collector
docker start oceanus-signoz-otel-collector

# 验证日志恢复写入
# Expected: Collector 恢复后，队列中的日志继续写入 SigNoz
```

- [ ] **Step 5: 清理旧数据卷**

```bash
docker volume rm oceanus_loki_data oceanus_grafana_data 2>/dev/null || true
```

- [ ] **Step 6: 移除临时验证代码**

确认 `server/src/chat/chat.service.ts` 中不残留 `sigNoz-trace-test` 日志。

- [ ] **Step 7: 更新流程图**

修改 `docs/2-architecture/overview.md` 中的四层架构图：

- 基础设施层：移除 `Loki[Grafana + Loki]`，替换为 `Logs[SigNoz]`

```mermaid
    subgraph Infra[基础设施]
        PG[(PostgreSQL)]
        JSONL[(JSONL 文件)]
        Logs[SigNoz<br/>日志聚合]
        Langfuse[Langfuse]
    end
```

- [ ] **Step 8: 更新端口表**

修改 `docs/2-architecture/overview.md` 端口表：

- `Grafana | 3002` → 删除
- `Loki | 3100` → 删除
- 新增 `SigNoz | 8080`

- [ ] **Step 9: 更新基础设施说明**

修改 `docs/2-architecture/overview.md` 中的四层职责表：

- `Loki（日志）` → `SigNoz（日志）`
- 日志流说明：`stdout → Promtail → Loki` → `Pino → OTel → SigNoz`

- [ ] **Step 10: 最终验证**

```bash
# 确认类型检查通过
cd server && npx tsc --noEmit

# 确认 lint 通过
cd server && npx eslint src/

# 确认单元测试通过
pnpm test
```

- [ ] **Step 11: 最终提交**

```bash
git add server/src/ docs/2-architecture/overview.md
git commit -m "docs: update architecture docs for SigNoz migration"
```

---

### Task 4: 清理残留文件（可选）

**Files:** 无代码改动

- [ ] **Step 1: 检查是否有遗漏的旧组件引用**

```bash
grep -r "loki\|promtail\|grafana" docker-compose.yml server/ infra/ docs/ \
  --include="*.{yml,yaml,md,ts,json}" \
  -l | grep -v node_modules
# Expected: 无匹配（或仅保留说明性引用）
```

- [ ] **Step 2: 检查 loki_data / grafana_data volume 是否已彻底移除**

```bash
docker volume ls | grep -E "loki|grafana"
# Expected: 无输出
```
