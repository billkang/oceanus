# ─── Oceanus Makefile ─────────────────────────────────────────────
# Makefile 管基础设施和编排；开发命令委托给 pnpm scripts。
#
# 全部命令在项目根目录执行即可。用法：
#   make help              显示本帮助
#
# 设计原则：
#   Makefile → Docker、环境文件、初始化、日志等编排
#   pnpm    → dev、build、test 等开发命令（复用 pnpm workspace）

.PHONY: install setup \
        db-up db-up-min db-down db-status db-setup db-studio db-generate db-seed db-migrate db-reset db-logs \
        dev server server-dev server-build server-lint server-test \
        client client-dev client-build client-lint client-test \
        test lint format typecheck type-check logs langfuse clean help

# ─── 首次安装 ─────────────────────────────────────────────────────

install:           ## 安装所有依赖（pnpm workspace 自动处理 server + client）
	pnpm install

setup: env db-up db-setup  ## 一键初始化：配置 → 启动 DB → 建表+种子

env:               ## 从模板创建 .env（已存在则跳过）
	@if [ ! -f server/.env ]; then \
		cp server/.env.example server/.env; \
		echo "✅ 已创建 server/.env，请编辑填入你的 API Key"; \
	else \
		echo "ℹ️  server/.env 已存在，跳过"; \
	fi

# ─── Docker 基础设施 ──────────────────────────────────────────────

db-up:             ## 启动全部基础设施（PostgreSQL + Redis + ClickHouse + MinIO + Langfuse）
	docker compose up -d && \
	echo "⏳ 等待 PostgreSQL 就绪..." && \
	until docker compose exec postgres pg_isready -U root -d oceanus 2>/dev/null; do sleep 1; done && \
	echo "✅ 所有服务已启动"

db-up-min:         ## 仅启动 PostgreSQL（不含 Langfuse）
	docker compose up -d postgres && \
	echo "⏳ 等待 PostgreSQL 就绪..." && \
	until docker compose exec postgres pg_isready -U root -d oceanus 2>/dev/null; do sleep 1; done && \
	echo "✅ PostgreSQL 已就绪"

db-down:           ## 停止所有 Docker 服务
	docker compose down

db-status:         ## 查看 Docker 服务状态
	docker compose ps

db-logs:           ## 查看 Docker 服务日志
	docker compose logs -f

# ─── Prisma 数据库 ────────────────────────────────────────────────

db-setup:          ## 运行迁移 + 生成 Client + 种子数据
	cd server && npx prisma migrate dev --name init 2>/dev/null; \
		pnpm db:generate && \
		pnpm db:seed
	@echo "✅ 数据库初始化完成"

db-migrate:        ## 创建新迁移（用法: make db-migrate name=xxx）
	cd server && npx prisma migrate dev --name $(name)

db-generate:       ## 生成 Prisma Client
	pnpm db:generate

db-seed:           ## 填充种子数据
	pnpm db:seed

db-studio:         ## 打开 Prisma Studio 数据浏览器
	pnpm db:studio

db-reset:          ## 重置数据库（清空数据，重新迁移+种子）
	pnpm db:reset

# ─── 开发服务 ─────────────────────────────────────────────────────

dev:               ## 启动后端 + 前端（先杀掉旧进程，Ctrl+C 停止全部）
	@echo "🔪 清理旧进程..."
	@lsof -ti :3100 | xargs kill -9 2>/dev/null || true
	@lsof -ti :4300 | xargs kill -9 2>/dev/null || true
	@echo "🚀 启动 Oceanus 开发模式..."
	@echo "   后端 → http://localhost:3100"
	@echo "   前端 → http://localhost:4300"
	@echo "   Swagger → http://localhost:3100/api/docs"
	pnpm dev

server: server-dev ## 启动后端（默认 = dev 模式）

server-dev:        ## 单独启动后端（热重载）
	cd server && pnpm start:dev

server-build:      ## 构建后端
	cd server && pnpm build

server-lint:       ## 后端代码检查
	cd server && pnpm lint

server-test:       ## 后端测试
	cd server && pnpm test

server-test-watch: ## 后端测试（监听模式）
	cd server && pnpm test:watch

client: client-dev ## 启动前端（默认 = dev 模式）

client-dev:        ## 单独启动前端
	cd client && pnpm start

client-build:      ## 构建前端
	cd client && pnpm build

client-lint:       ## 前端代码检查
	cd client && pnpm lint

client-test:       ## 前端测试
	cd client && pnpm test

# ─── 统一命令 ─────────────────────────────────────────────────────

test: server-test  ## 运行测试（目前仅后端；前端测试: make client-test）

lint:              ## 运行全部代码检查
	cd server && pnpm lint
	cd client && pnpm lint

format:            ## 自动格式化全部代码
	pnpm format:fix

typecheck: type-check
type-check:        ## TypeScript 类型检查（后端）
	cd server && npx tsc --noEmit

logs:              ## 查看后端日志
	@if [ -f server/logs/combined.log ]; then \
		tail -f server/logs/combined.log | pino-pretty --translateTime "HH:MM:ss"; \
	else \
		echo "ℹ️  日志文件不存在，启动后端后自动创建"; \
	fi

clean:             ## 清理 node_modules 和构建产物
	rm -rf node_modules server/node_modules server/dist server/logs \
		client/node_modules client/dist
	@echo "✅ 已清理 node_modules、dist、logs"

langfuse:          ## 打开 Langfuse 可观测平台
	pnpm langfuse

# ─── 帮助 ─────────────────────────────────────────────────────────

help:              ## 显示本帮助
	@echo "Oceanus 开发命令"
	@echo ""
	@echo "首次使用:"
	@echo "  make install      安装所有依赖"
	@echo "  make setup        一键初始化（env → db-up → db-setup）"
	@echo ""
	@echo "日常开发:"
	@echo "  make dev          启动后端 + 前端"
	@echo "  make db-up-min    只需 PostgreSQL 时"
	@echo "  make db-up        需要 Langfuse 时（含 Redis + ClickHouse + MinIO）"
	@echo "  make server-dev   单独启动后端"
	@echo "  make client-dev   单独启动前端"
	@echo "  make test         运行后端测试"
	@echo ""
	@echo "数据库:"
	@echo "  make db-studio             打开 Prisma Studio 数据浏览器"
	@echo "  make db-generate           生成 Prisma Client"
	@echo "  make db-migrate name=xxx   创建新迁移"
	@echo "  make db-setup              迁移 + 种子"
	@echo "  make db-seed               填充种子数据"
	@echo "  make db-reset              重置数据库"
	@echo ""
	@echo "平台:"
	@echo "  make langfuse              打开 Langfuse 可观测平台"
	@echo "                               → http://localhost:3001"
	@echo ""
	@echo "代码质量:"
	@echo "  make lint         代码检查"
	@echo "  make format       自动格式化"
	@echo "  make typecheck    TypeScript 类型检查"
	@echo ""
	@echo "查看全部:  make help"
