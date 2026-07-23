# Oceanus — AI 全链路开发中台

> **Oceanus（俄刻阿诺斯）**，古希腊神话中的大洋神，万物之源，万流之宗。

Oceanus 是一个基于 **Claude Agent SDK** 与 **DeepStorm** 构建的 AI 中台平台，将以产品讨论、需求分析、代码生成到部署运维的研发流程全链路平台化。

- 📖 **系统设计总览** → [docs/oceanus-system-overview.md](docs/oceanus-system-overview.md)（业务背景、技术架构、选型决策）
- 🔧 **本文档** → 项目结构、开发环境搭建、日常操作命令

---

## 快速开始

### 前置条件

| 工具 | 版本要求 | 用途 |
|------|---------|------|
| [Node.js](https://nodejs.org/) | >= 20 | 运行后端和前端 |
| [pnpm](https://pnpm.io/installation) | >= 9 | 包管理 |
| [Docker](https://docs.docker.com/engine/install/) | 最新 | 数据库和可观测性服务 |
| [Claude Agent SDK](https://code.claude.com/docs/zh-CN/overview) | — | Claude Agent SDK 概述 |

### 安装 Docker

**macOS：**

```bash
brew install --cask docker
```

**Ubuntu / Debian：**

```bash
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

验证安装：

```bash
docker --version
docker compose version
```

### 克隆并安装依赖

```bash
git clone <your-repo-url> oceanus
cd oceanus
make install    # 一键安装所有依赖（root + server + client）
```

### 一键初始化

```bash
make setup      # 配置 .env → 启动数据库 → 建表 + 种子数据
```

然后编辑 `server/.env`，填入你的 API Key。

### 启动开发服务

```bash
make dev        # 同时启动后端（:3100）+ 前端（:4300）
```

或分两个终端：

```bash
make server-dev   # 终端 1 — 后端（热重载）
make client-dev   # 终端 2 — 前端
```

### 登录

打开 `http://localhost:4300`，使用测试账号：

| 用户名  | 密码       | 角色   |
|---------|-----------|--------|
| `admin` | `admin123` | 管理员 |

---

## Docker 服务

所有基础设施通过 Docker Compose 管理，无需手动安装。

### 服务清单

| 服务             | 容器名                     | 端口              | 用途                           |
|-----------------|---------------------------|-------------------|-------------------------------|
| PostgreSQL      | `oceanus-postgres`        | 5432              | 主数据库                       |
| Redis           | `oceanus-redis`           | 6379              | Langfuse 缓存依赖              |
| ClickHouse      | `oceanus-clickhouse`      | 8123 / 9000       | Langfuse 分析型存储             |
| MinIO           | `oceanus-minio`           | 9100 / 9101       | Langfuse S3 兼容对象存储        |
| Langfuse Worker | `oceanus-langfuse-worker` | —                 | Langfuse 异步事件处理器          |
| Langfuse Web    | `oceanus-langfuse`        | 3001              | LLM 可观测性控制台              |

### 日常命令

```bash
make db-up-min    # 最小模式（仅 PostgreSQL，日常推荐）
make db-up        # 完整模式（全部服务）
make db-down      # 停止所有容器（数据保留在 volume 中）
make db-status    # 查看服务状态
make db-logs      # 查看所有容器日志
make db-logs postgres  # 仅查看 PostgreSQL 日志
```

> **磁盘提示：** ClickHouse 预分配约 2-4 GB 磁盘空间。日常开发推荐 `make db-up-min`。
> 停止容器用 `make db-down`，数据保留；`docker compose down -v` 会**永久删除**数据卷。

---

## 接入 Langfuse 可观测性（可选）

Langfuse 记录 Claude Agent SDK 的工具调用、Token 消耗和响应延迟，用于调试和优化 AI Agent 行为。

### 前提

确认 Langfuse 及其依赖已启动（端口 3001 可访问）：

```bash
make db-up    # 或: docker compose up -d redis clickhouse minio langfuse-web langfuse-worker
```

### 获取密钥

1. 访问 `http://localhost:3001` 注册账号（本地任意邮箱即可）
2. 进入 **Settings → API Keys**，复制 Public Key 和 Secret Key

### 配置环境变量

编辑 `server/.env`：

```env
LANGFUSE_PUBLIC_KEY=pk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=http://localhost:3001
```

### 验证

重启后端后在聊天界面发一条消息，访问 `http://localhost:3001` → **Traces** 面板查看。

> **安全设计：** `LANGFUSE_BASE_URL` 未配置时，`LangfuseService` 自动进入静默模式（no-op），不会导致应用启动失败。

---

## 脚本速查

全部命令在项目根目录执行。Makefile 负责基础设施编排（Docker、数据库），开发命令委托给 pnpm。

```bash
# ── 首次使用 ──
make install        # 安装所有依赖
make setup          # 一键初始化（.env → 数据库 → 建表 + 种子数据）

# ── 日常开发 ──
make dev            # 同时启动后端（:3100）+ 前端（:4300）
make server-dev     # 单独启动后端（热重载）
make client-dev     # 单独启动前端
make test           # 运行后端测试
make logs           # 查看后端日志

# ── 数据库 ──
make db-up          # 启动全部 Docker 服务
make db-up-min      # 仅启动 PostgreSQL
make db-down        # 停止所有 Docker 服务
make db-setup       # 迁移 + 生成 Prisma Client + 种子数据
make db-migrate name=xxx  # 创建新迁移
make db-studio      # 打开 Prisma Studio
make db-reset       # 重置数据库

# ── 代码质量 ──
make lint           # ESLint 检查（server + client）
make format         # Prettier 自动格式化
make typecheck      # TypeScript 类型检查

# ── 帮助 ──
make help           # 显示全部可用命令
```

---

## 技术栈

| 领域       | 技术选型                     |
|-----------|-----------------------------|
| **前端**   | Angular 21 + PrimeNG + Tailwind CSS |
| **后端**   | NestJS 11 (Node.js)          |
| **ORM**    | Prisma 6                     |
| **数据库** | PostgreSQL 17                |
| **AI 框架** | Claude Agent SDK            |
| **包管理** | pnpm (workspace)             |
| **任务编排** | Makefile                    |
| **可观测性** | Langfuse（可选）             |

---

## 项目结构

```
oceanus/
├── client/                 # Web 前端（Angular）
│   ├── src/app/
│   │   ├── asset/          # 资产中心
│   │   ├── auth/           # 认证（AuthService, AuthGuard, HttpInterceptor）
│   │   ├── chat/           # 对话界面 + SSE 流式渲染
│   │   ├── login/          # 登录页
│   │   ├── notifications/  # 通知
│   │   ├── project/        # 项目管理
│   │   ├── session/        # 会话管理
│   │   └── workspace/      # 工作台
│   └── ...
├── server/                 # 后端（NestJS）
│   ├── src/
│   │   ├── agent/          # Claude Agent SDK 封装
│   │   ├── asset/          # 资产模块
│   │   ├── auth/           # 认证模块（JWT）
│   │   ├── chat/           # 对话 + SSE 流
│   │   ├── common/         # 公共组件（Langfuse 等）
│   │   ├── project/        # 项目模块
│   │   └── session/        # 会话模块
│   ├── prisma/
│   │   ├── schema.prisma   # 数据模型
│   │   └── seed.ts         # 测试种子数据
│   └── ...
├── docs/                   # 系统文档
│   ├── oceanus-system-overview.md   # ← 系统设计总览
│   ├── presentation.html            # 项目演示文稿
│   └── diagrams/                    # 架构图（.mmd + .svg）
├── docker-compose.yml      # PostgreSQL + Redis + ClickHouse + MinIO + Langfuse (Web + Worker)
├── pnpm-workspace.yaml     # pnpm workspace 配置
├── Makefile                # 命令集中编排
├── server/.env.example     # 环境变量模板
└── README.md
```

---

## 文档层次

| 文档 | 内容定位 |
|------|---------|
| **`README.md`** | 项目概览 + 开发环境搭建 + 日常操作命令 |
| **`docs/oceanus-system-overview.md`** | 系统设计总览——业务背景、技术架构、技术选型、数据模型 |
| **`docs/presentation.html`** | 项目演示文稿（可在浏览器中直接打开） |
| **`docs/diagrams/`** | 架构图（Mermaid + SVG 渲染） |

---

> *"Oceanus — 万物之源，川流不息。每一个项目都是一条新的河流，从这同一个源头出发，奔向远方。"*
>
> 更多系统设计细节 → [docs/oceanus-system-overview.md](docs/oceanus-system-overview.md)
