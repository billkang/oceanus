# Grafana + Loki Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add centralized log collection (Grafana + Loki + Promtail) to Oceanus Docker Compose stack, and reconfigure Pino to output structured logs to stdout with a configurable `LOG_LEVEL`.

**Architecture:** Pino writes structured JSON logs to stdout → Docker captures container stdout → Promtail reads Docker log files from host → pushes to Loki → Grafana queries Loki with pre-configured datasource. `LOG_LEVEL` env var controls Pino output level (default: info in production, debug in development).

**Tech Stack:** Docker Compose, Grafana 11, Loki 3, Promtail 3, NestJS + Pino

## Global Constraints

- All new Docker services use `--profile app` to match existing server/client profile
- Grafana port 3002 (avoid conflict with Langfuse at 3001)
- Loki port 3100 (internal, for Promtail push + Grafana query)
- Promtail only collects `oceanus-server` container logs
- Loki log retention: 7 days
- Grafana uses provisioning directory for auto-configuration (no manual setup)
- `LOG_LEVEL` defaults: `debug` when NODE_ENV is not `production`, `info` when NODE_ENV is `production`
- `LOG_LEVEL` invalid values fall back to `info` with warning log
- All infra config files go under `infra/`

---

### Task 1: Loki 配置

**Files:**

- Create: `infra/loki/loki-config.yml`

**Interfaces:**

- Consumes: nothing
- Produces: Loki config consumed by Docker Compose loki service

- [ ] **Step 1: Create loki-config.yml**

```yaml
# infra/loki/loki-config.yml
auth_enabled: false

server:
  http_listen_port: 3100

ingester:
  lifecycler:
    ring:
      kvstore:
        store: inmemory
      replication_factor: 1
  wal:
    dir: /loki/wal

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v12
      index:
        prefix: index_
        period: 24h

storage_config:
  filesystem:
    directory: /loki/chunks

compactor:
  working_directory: /loki/compactor

limits_config:
  retention_period: 168h # 7 days
  reject_old_samples: true
  reject_old_samples_max_age: 168h

table_manager:
  retention_deletes_enabled: true
  retention_period: 168h
```

- [ ] **Step 2: 验证文件 YAML 格式**

无需单独验证，文件将在 Task 4 Docker Compose 集成时整体验证。

- [ ] **Step 3: Commit**

```bash
git add infra/loki/loki-config.yml
git commit -m "feat: add Loki configuration with 7-day retention"
```

---

### Task 2: Promtail 配置

**Files:**

- Create: `infra/promtail/promtail-config.yml`

**Interfaces:**

- Consumes: Docker container logs at `/var/lib/docker/containers`
- Produces: Log stream pushed to Loki at `http://loki:3100`

- [ ] **Step 1: Create promtail-config.yml**

```yaml
# infra/promtail/promtail-config.yml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: docker
    pipeline_stages:
      - docker: {}
      - json:
          expressions:
            level: level
            msg: msg
            traceId: traceId
      - labels:
          level:
      - static_labels:
          service: server
          container: oceanus-server

    docker_sd_configs:
      - host: unix:///var/run/docker.sock
        refresh_interval: 5s

    relabel_configs:
      - source_labels: [__meta_docker_container_name]
        regex: /oceanus-server
        action: keep
      - source_labels: [__meta_docker_container_name]
        target_label: container_name
        regex: /(.+)
        replacement: $1
```

- [ ] **Step 2: Commit**

```bash
git add infra/promtail/promtail-config.yml
git commit -m "feat: add Promtail configuration with oceanus-server container filter"
```

---

### Task 3: Grafana 预配置

**Files:**

- Create: `infra/grafana/provisioning/datasources/datasources.yml`
- Create: `infra/grafana/provisioning/dashboards/dashboard.yml`
- Create: `infra/grafana/provisioning/dashboards/oceanus-logs.json`

**Interfaces:**

- Consumes: Loki at `http://loki:3100`
- Produces: Auto-configured Grafana datasource + dashboard

- [ ] **Step 1: Create Grafana Loki datasource provisioning**

```yaml
# infra/grafana/provisioning/datasources/datasources.yml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    jsonData:
      maxLines: 1000
      derivedFields:
        - datasourceUid: Loki
          matcherRegex: "traceId\":\"(\\w+)\""
          name: traceId
          url: ''
```

- [ ] **Step 2: Create Grafana dashboard loader**

```yaml
# infra/grafana/provisioning/dashboards/dashboard.yml
apiVersion: 1

providers:
  - name: Oceanus
    type: file
    updateIntervalSeconds: 30
    options:
      path: /etc/grafana/provisioning/dashboards
      foldersFromFilesStructure: false
```

- [ ] **Step 3: Create Oceanus logs dashboard JSON**

```json
{
  "annotations": {
    "list": []
  },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "liveNow": false,
  "panels": [
    {
      "datasource": {
        "type": "loki",
        "uid": "Loki"
      },
      "fieldConfig": {
        "defaults": {},
        "overrides": []
      },
      "gridPos": {
        "h": 10,
        "w": 24,
        "x": 0,
        "y": 0
      },
      "id": 1,
      "options": {
        "dedupStrategy": "none",
        "showCommonLabels": false,
        "showLabels": false,
        "showTime": true,
        "sortOrder": "Descending",
        "wrapLogMessage": true,
        "prettifyLogJson": true
      },
      "targets": [
        {
          "datasource": {
            "type": "loki",
            "uid": "Loki"
          },
          "editorMode": "builder",
          "expr": "{container=\"oceanus-server\"} |= \"\"",
          "queryType": "range",
          "refId": "A"
        }
      ],
      "title": "Oceanus 实时日志流",
      "type": "logs"
    },
    {
      "datasource": {
        "type": "loki",
        "uid": "Loki"
      },
      "fieldConfig": {
        "defaults": {
          "custom": {
            "displayMode": "list",
            "minWidth": 80
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 0,
        "y": 10
      },
      "id": 2,
      "options": {
        "orientation": "auto",
        "reduceOptions": {
          "calcs": ["lastNotNull"],
          "fields": "",
          "values": false
        },
        "showThresholdLabels": false,
        "showThresholdMarkers": true
      },
      "targets": [
        {
          "datasource": {
            "type": "loki",
            "uid": "Loki"
          },
          "editorMode": "code",
          "expr": "sum by (level) (count_over_time({container=\"oceanus-server\"} [$__interval]))",
          "legendFormat": "{{level}}",
          "queryType": "range",
          "refId": "A"
        }
      ],
      "title": "日志级别分布",
      "type": "barchart"
    },
    {
      "datasource": {
        "type": "loki",
        "uid": "Loki"
      },
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "palette-classic"
          },
          "custom": {
            "axisCenteredZero": false,
            "axisColorMode": "text",
            "axisLabel": "",
            "axisPlacement": "auto",
            "barAlignment": 0,
            "drawStyle": "line",
            "fillOpacity": 10,
            "gradientMode": "none",
            "hideFrom": {
              "legend": false,
              "tooltip": false,
              "viz": false
            },
            "lineInterpolation": "linear",
            "lineWidth": 1,
            "pointSize": 5,
            "scaleDistribution": {
              "type": "linear"
            },
            "showPoints": "auto",
            "spanNulls": false,
            "stacking": {
              "group": "A",
              "mode": "none"
            },
            "thresholdsStyle": {
              "mode": "off"
            }
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 80
              }
            ]
          }
        },
        "overrides": []
      },
      "gridPos": {
        "h": 8,
        "w": 12,
        "x": 12,
        "y": 10
      },
      "id": 3,
      "options": {
        "legend": {
          "calcs": [],
          "displayMode": "list",
          "placement": "bottom",
          "showLegend": true
        },
        "tooltip": {
          "mode": "multi",
          "sort": "none"
        }
      },
      "targets": [
        {
          "datasource": {
            "type": "loki",
            "uid": "Loki"
          },
          "editorMode": "code",
          "expr": "sum by (level) (count_over_time({container=\"oceanus-server\"} [$__interval]))",
          "legendFormat": "{{level}}",
          "queryType": "range",
          "refId": "A"
        }
      ],
      "title": "日志时间序列",
      "type": "timeseries"
    }
  ],
  "refresh": "10s",
  "schemaVersion": 39,
  "tags": ["oceanus", "logs"],
  "templating": {
    "list": [
      {
        "current": {
          "selected": true,
          "text": "oceanus-server",
          "value": "oceanus-server"
        },
        "hide": 0,
        "includeAll": false,
        "multi": false,
        "name": "container",
        "options": [],
        "query": {
          "query": "label_values(container)",
          "refId": "StandardVariableQuery"
        },
        "refresh": 1,
        "regex": "",
        "type": "query"
      }
    ]
  },
  "time": {
    "from": "now-15m",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "",
  "title": "Oceanus 日志",
  "uid": "oceanus-logs",
  "version": 1
}
```

- [ ] **Step 4: Commit**

```bash
git add infra/grafana/provisioning/
git commit -m "feat: add Grafana provisioning for Loki datasource and Oceanus log dashboard"
```

---

### Task 4: Docker Compose 编排

**Files:**

- Modify: `docker-compose.yml`

**Interfaces:**

- Consumes: infra config files from Tasks 1-3
- Produces: Loki + Promtail + Grafana services running with correct config mounts

- [ ] **Step 1: 在 volumes 段新增 Loki 和 Grafana 数据卷**

找到文件末尾的 `volumes:` 段，新增两个 volume：

```yaml
volumes:
  postgres_data:
  redis_data:
  clickhouse_data:
  minio_data:
  loki_data:
  grafana_data:
```

- [ ] **Step 2: 在 Grafana 的 provisioning dashboard.yml 之后、server 服务之前新增 Loki 服务**

```yaml
# ── Loki（日志存储）───────────────────────────────────────────
loki:
  profiles: [app]
  image: grafana/loki:latest
  container_name: oceanus-loki
  restart: unless-stopped
  ports:
    - '3100:3100'
  volumes:
    - ./infra/loki:/etc/loki
    - loki_data:/loki
  command: -config.file=/etc/loki/loki-config.yml
  healthcheck:
    test: ['CMD', 'wget', '-qO-', 'http://localhost:3100/ready']
    interval: 10s
    timeout: 5s
    retries: 5
```

- [ ] **Step 3: 在 Loki 之后新增 Promtail 服务**

```yaml
# ── Promtail（日志采集）───────────────────────────────────────
promtail:
  profiles: [app]
  image: grafana/promtail:latest
  container_name: oceanus-promtail
  restart: unless-stopped
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - ./infra/promtail:/etc/promtail
  command: -config.file=/etc/promtail/promtail-config.yml
  depends_on:
    loki:
      condition: service_healthy
```

- [ ] **Step 4: 在 Promtail 之后新增 Grafana 服务**

```yaml
# ── Grafana（日志可视化）────────────────────────────────────
grafana:
  profiles: [app]
  image: grafana/grafana:latest
  container_name: oceanus-grafana
  restart: unless-stopped
  ports:
    - '3002:3000'
  volumes:
    - ./infra/grafana/provisioning:/etc/grafana/provisioning
    - grafana_data:/var/lib/grafana
  depends_on:
    loki:
      condition: service_healthy
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Loki, Promtail, and Grafana services to Docker Compose"
```

---

### Task 5: Pino 配置改造

**Files:**

- Modify: `server/src/app.module.ts` (Pino transport config)

**Interfaces:**

- Consumes: `process.env.LOG_LEVEL`, `process.env.NODE_ENV`
- Produces: Pino logger outputting to stdout with configurable level

- [ ] **Step 1: 修改 app.module.ts 中 LoggerModule 配置**

找到 LoggerModule.forRoot 的 transport.targets 段，原代码：

```typescript
transport: {
  targets: [
    // 开发环境：控制台美化输出
    ...(process.env.NODE_ENV !== 'production'
      ? [
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            level: 'debug',
          },
        ]
      : [
          {
            target: 'pino/file',
            options: { destination: 1 },
            level: 'warn',
          },
        ]),
    // 始终写入文件
    {
      target: 'pino/file',
      options: { destination: './logs/combined.log', mkdir: true },
      level: 'info',
    },
  ],
},
```

替换为：

```typescript
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// 验证 LOG_LEVEL 是否合法
const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
const effectiveLevel = validLevels.includes(logLevel) ? logLevel : (() => {
  console.warn(`Invalid LOG_LEVEL "${logLevel}", falling back to "info"`);
  return 'info';
})();

// ...

transport: {
  targets: [
    ...(process.env.NODE_ENV !== 'production'
      ? [
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            level: effectiveLevel,
          },
        ]
      : [
          {
            target: 'pino/file',
            options: { destination: 1 },
            level: effectiveLevel,
          },
        ]),
    // 已移除文件日志 — 改为 Docker + Loki 采集
  ],
},
```

> 注意：`effectiveLevel` 变量声明需要放在 `LoggerModule.forRoot()` 调用之前。

- [ ] **Step 2: Commit**

```bash
git add server/src/app.module.ts
git commit -m "feat: parameterize Pino log level with LOG_LEVEL env var, remove file target"
```

---

### Task 6: 环境变量配置

**Files:**

- Modify: `server/.env`
- Modify: `server/.env.example`
- Modify: `docker-compose.yml` (server.environment)

**Interfaces:**

- Consumes: nothing
- Produces: `LOG_LEVEL` available in both local dev and Docker environments

- [ ] **Step 1: 在 server/.env 中新增 LOG_LEVEL**

在 `# 服务` 段下新增：

```env
# 服务
PORT=3100
CORS_ORIGIN=http://localhost:4300
LOG_LEVEL=info
```

- [ ] **Step 2: 在 server/.env.example 中新增 LOG_LEVEL**

```env
# 日志级别（fatal / error / warn / info / debug / trace）
# 默认：NODE_ENV=production 时 info，否则 debug
LOG_LEVEL=info
```

- [ ] **Step 3: 在 docker-compose.yml 的 server.environment 中新增 LOG_LEVEL**

找到 server 服务的 environment 段，新增：

```yaml
environment:
  DATABASE_URL: postgresql://root:123456@postgres:5432/oceanus
  JWT_SECRET: dev-secret-change-in-production
  CORS_ORIGIN: http://localhost
  GLITCHTIP_DSN: http://glitchtip-web:8000/1
  LOG_LEVEL: info
```

- [ ] **Step 4: Commit**

```bash
git add server/.env server/.env.example docker-compose.yml
git commit -m "chore: add LOG_LEVEL env var to .env files and Docker Compose"
```

---

### Task 7: 清理与验证

**Files:**

- Delete: `server/logs/combined.log` (if exists)

- [ ] **Step 1: 删除文件日志**

```bash
# 删除旧的 combined.log
rm -f server/logs/combined.log

# 删除空的 logs 目录（如果只剩 combined.log）
rmdir server/logs 2>/dev/null || true
```

- [ ] **Step 2: 本地验证 — 启动后端，确认 pino-pretty 输出正常**

```bash
cd server && pnpm start:dev
```

Expected: 应用正常启动，终端看到带颜色的 pino-pretty 日志输出，log 级别由 LOG_LEVEL 控制。

- [ ] **Step 3: Docker 验证 — 全栈启动，确认日志采集**

```bash
docker compose --profile app up -d
```

确认所有服务健康：

```bash
docker compose --profile app ps
```

确认 Grafana 可访问并显示 Oceanus 仪表盘：

```bash
open http://localhost:3002
```

确认 Loki 有日志流入（Grafana Explore → 选 Loki → `{container="oceanus-server"}`）：

```bash
# 或通过 Loki API 验证
curl -s "http://localhost:3100/loki/api/v1/labels" | grep server
```

- [ ] **Step 4: LOG_LEVEL 验证 — 修改级别确认生效**

```bash
# 设置 LOG_LEVEL=warn 然后 docker compose restart
LOG_LEVEL=warn docker compose --profile app up -d
# 确认 debug/info 日志不再输出
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: cleanup file logs and verify logging stack"
```

---

### 自审检查

| 检查项                                                 |    结果     |
| ------------------------------------------------------ | :---------: |
| **Spec 覆盖** — log-infrastructure 全部场景有对应 task | ✅ Task 1-4 |
| **Spec 覆盖** — log-level-config 全部场景有对应 task   | ✅ Task 5-6 |
| **占位符扫描** — 无 TBD/TODO/implement later           |   ✅ 通过   |
| **类型一致性** — 跨 task 的文件路径、端口号一致        |   ✅ 通过   |
