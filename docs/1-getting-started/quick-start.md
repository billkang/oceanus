# 5 分钟快速启动

> 极简版。完整环境配置见 [environment.md](environment.md)。

## 前置条件

- Node.js >= 24
- pnpm 11.17.0（corepack 自动管控）
- Docker

## 步骤

```bash
# 1. 克隆并安装
git clone <repo-url> oceanus && cd oceanus
make install

# 2. 初始化（.env → 数据库 → 建表）
make setup

# 3. 启动开发服务
make dev        # :3100（后端）+ :4300（前端）
```

打开 `http://localhost:4300`，使用 `admin` / `admin123` 登录。

## 常见问题

| 问题           | 解决                                              |
| -------------- | ------------------------------------------------- |
| 端口被占用     | 检查 3100/4300/5432 是否已被使用                  |
| Docker 未运行  | 先启动 Docker Desktop 或 `systemctl start docker` |
| 数据库连接失败 | 确认 `make db-up-min` 已执行，PostgreSQL 正常     |
