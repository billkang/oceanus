# Oceanus — AI 全链路开发中台

> **Oceanus（俄刻阿诺斯）**，古希腊神话中的大洋神，万物之源，万流之宗。

基于 **Claude Agent SDK** 与 **DeepStorm** 构建的 AI 中台平台，将产品讨论、需求分析、代码生成到部署运维的研发流程全链路平台化。

> _Oceanus — 万物之源，川流不息。每一个项目都是一条新的河流，从这同一个源头出发，奔向远方。_
>
> 📖 **文档入口** → [docs/INDEX.md](docs/INDEX.md)

---

## 快速启动

### 前置条件

- Node.js >= 24
- pnpm 11.17.0（corepack 自动管控）
- Docker（最新版）

### 安装并启动

```bash
git clone <repo-url> oceanus && cd oceanus
make install     # 安装所有依赖
make setup       # 配置 .env → 启动 DB → 建表 + 种子数据
make dev         # 同时启动后端（:3100）+ 前端（:4300）
```

### 登录

| 用户名  | 密码       | 角色   |
| ------- | ---------- | ------ |
| `admin` | `admin123` | 管理员 |

---

## 项目结构

```
oceanus/
├── client/          # Angular SPA
│   └── src/app/     # asset, auth, chat, login, project, session, workspace
├── server/          # NestJS 后端
│   ├── src/         # auth, project, session, chat, agent, asset, common
│   └── prisma/      # schema.prisma + seed.ts
├── docs/            # 文档（见 docs/INDEX.md）
├── infra/           # Loki, Promtail, Grafana 配置
├── openspec/        # 规范与 Spec 文档
├── docker-compose.yml
├── Makefile
└── pnpm-workspace.yaml
```

---

## 日常命令

```bash
make dev          # 同时启动前后端
make test         # 运行后端测试
make lint         # ESLint 检查
make typecheck    # TypeScript 类型检查
make format       # Prettier 格式化
make db-up-min    # 仅启动 PostgreSQL
make db-up        # 启动全部 Docker 服务
make db-down      # 停止所有 Docker 服务
make help         # 全部可用命令
```

---

## 技术栈

| 领域     | 选型                                |
| -------- | ----------------------------------- |
| 前端     | Angular 21 + PrimeNG + Tailwind CSS |
| 后端     | NestJS 11                           |
| 数据库   | PostgreSQL 17 + Prisma 6            |
| AI 引擎  | Claude Agent SDK（TypeScript）      |
| 可观测性 | Langfuse（可选）+ Grafana + Loki    |

---

## 文档指引

| 入口                                              | 内容                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| [文档首页](docs/INDEX.md)                         | 按角色分类的文档索引                              |
| [环境配置](docs/1-getting-started/environment.md) | Docker 服务、环境变量、Langfuse/GlitchTip/Grafana |
| [架构总览](docs/2-architecture/overview.md)       | 模块、分层、数据流                                |
| [ADR 索引](docs/2-architecture/decisions/)        | 架构决策记录                                      |
| [API 参考](docs/3-api/api-reference.md)           | REST API + SSE 事件                               |
| [贡献指南](docs/6-contributing/CONTRIBUTING.md)   | 代码规范、PR 流程                                 |
