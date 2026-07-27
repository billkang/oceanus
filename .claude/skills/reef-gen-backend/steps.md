# Node.js / NestJS 后端编码步骤

按以下顺序逐块编写，依赖关系由前向后：

1. **Prisma Schema** — 定义数据模型（`prisma/schema.prisma`），**先于所有代码**，因为它决定类型结构
2. **DTO** — 数据传输对象（请求/响应），使用 `class-validator` + `@nestjs/swagger` 装饰器
3. **Entity** — Prisma 生成的 TypeScript 类型，必要时封装为 Entity 类（可选）
4. **PrismaService** — 数据库访问服务（`PrismaModule` + `PrismaService`），如果尚未创建
5. **Service** — 业务逻辑层，依赖 `PrismaService`，事务处理
6. **Controller** — REST API，请求/响应，参数校验
7. **Module** — NestJS 模块，将 Controller/Service 注册到 DI 容器

每完成一块对照 `reef:reef-style-backend` 中对应章节检查。

## 注释要求

每类文件必须包含以下注释（缺少则视为未完成）：

| 文件类型          | 注释要求                                                                             |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Prisma Schema** | 每个 model 加 `/// 注释` 描述实体用途；每个字段加 `/// 注释`                         |
| **DTO**           | 类 JSDoc `/** 用途说明 */`；字段通过 `@ApiProperty({ description: '...' })` 提供文档 |
| **Service**       | 每个 public 方法加 JSDoc `/** 功能、@param、@returns */`；复杂逻辑内联注释说明       |
| **Controller**    | 每个端点加 `@ApiOperation({ summary: '...', description: '...' })`                   |
| **Module**        | 类 JSDoc `/** 模块职责 */`                                                           |

## 安全红线

- 所有环境变量通过 `ConfigService` 读取，禁止 `process.env` 直读
- 敏感字段（密码、Token）在 API 响应前使用 `select` 或 `@Exclude()` 排除
- 禁止在 TypeScript 代码中硬编码 API Key / Token
- Prisma 条件查询使用参数化查询（Prisma 默认安全），禁止手动拼接 `where` 条件
- API 端点需添加 `@ApiBearerAuth()` 和 `@UseGuards(AuthGuard())`

## 构建命令

```bash
# 依赖安装（在项目根目录执行）
pnpm install

# Prisma 客户端生成（在 server/ 目录执行）
cd server && npx prisma generate

# 代码检查
cd server && npx eslint src/ --ext .ts
cd server && npx prettier --check src/

# 测试
cd server && npx jest

# 构建
cd server && npx nest build
```
