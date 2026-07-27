# 后端编码快速参考 — Node.js / NestJS

按需加载。仅当你需要编写对应组件类型时阅读相关章节。

> 跨维度规范（适用所有后端代码）：
>
> - [API 规范](api-spec.md) — RESTful 命名、统一响应体、OpenAPI、版本策略
> - [依赖管理规范](dependency-management.md) — 版本一致性、CVE
> - [异常处理深度规范](exception-handling.md) — 异常层次、错误码、全局过滤
> - [安全红线](security-redlines.md) — P0/P1 安全规则（必须遵守）

## 速查

| 场景     | 决策                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 模块结构 | 每个业务模块一个 NestJS Module，独立 Controller/Service/DTO/Entity                                         |
| 依赖注入 | 构造函数注入，`@Injectable()` 装饰器，禁止 `@Inject()` 字段注入                                            |
| 参数验证 | DTO 使用 `class-validator` 装饰器（`@IsNotEmpty`、`@IsString`）                                            |
| 响应格式 | 统一使用 Controller 返回值，禁止在 Service 中直接返回 Response 对象                                        |
| 异步处理 | 所有数据库/IO 操作用 `async/await`，禁止裸 `.subscribe()` 或 `.then()`                                     |
| 配置管理 | 使用 `@nestjs/config` 的 `ConfigService`，禁止 `process.env` 直读（测试不可 mock）                         |
| 异常处理 | 使用 NestJS 全局异常过滤器（`ExceptionFilter`），禁止在 Controller 中 try-catch 吞异常                     |
| 日志     | 使用 `@nestjs/common` 的 `Logger`，构造函数中注入：`private readonly logger = new Logger(XxxService.name)` |
| 类型安全 | 禁止 `any` 类型，优先用 `unknown` + 类型守卫                                                               |
| 模块注册 | 动态模块用 `forRoot()/forFeature()` 模式，禁止在 Module 中直接 `new Provider()`                            |

## 代码风格

### LLM 常犯错误

- DTO 验证装饰器必须与 Swagger 装饰器同时存在（`@ApiProperty()` + `@IsString()`），禁止遗漏 Swagger
- Controller 方法用 `@HttpCode()` 显式声明状态码，不依赖默认 200
- Service 方法中数据库查询用 `findFirstOrThrow()` / `findUniqueOrThrow()` 替代手动 `if (!result) throw`
- Prisma 事务用 `$transaction` 包裹，禁止手动 `prisma.$executeRaw` 拼事务
- 枚举值用 `@nestjs/common` 的 `EnumValidationPipe` 校验，禁止手动 `if (!Object.values(E).includes(v))`
- 不在 Controller 中直接实例化 Service（由 DI 注入），不在 Service 中直接实例化 Repository（由 DI 注入）
- 所有 `catch` 块不能为空：要么 `throw` 重新抛出，要么 `this.logger.error()` + 返回 fallback

### TypeScript Decorator 使用规范

| 组件类型        | 必用装饰器                                                       | 说明                                     |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Controller      | `@Controller('prefix')`、`@Get()`/`@Post()`/`@Put()`/`@Delete()` | 路由定义                                 |
| DTO             | `@ApiProperty()`、`@IsString()`/`@IsNumber()`/`@IsOptional()`    | 验证 + Swagger                           |
| Service         | `@Injectable()`                                                  | DI 可注入                                |
| Module          | `@Module()`                                                      | NestJS 模块定义                          |
| Entity (Prisma) | 使用 Prisma Schema 定义，不额外装饰                              | TypeScript 类型由 `prisma generate` 生成 |

### 控件能力声明模式

NestJS 中通过 Interface 和 Provider 令牌实现能力声明：

```typescript
// 定义能力接口
export interface ToolCapability {
  readonly name: string;
  supports(context: ExecutionContext): boolean;
  execute(input: unknown): Promise<unknown>;
}

// 注册 Provider
@Module({
  providers: [{ provide: 'TOOL_CAPABILITIES', useClass: TextToolCapability, multi: true }],
})
export class ToolsModule {}
```

## 注释规则

| 文件类型                   | 注释要求                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| **Entity / Prisma Schema** | Prisma Schema 中每个 model 加 `/// 注释`；生成类型不修改                                 |
| **DTO**                    | 类 JSDoc `/** 用途说明 */`；字段装饰器自带文档（`@ApiProperty({ description: '...' })`） |
| **Service**                | 每个 public 方法加 JSDoc `/** 功能、@param、@returns */`                                 |
| **Controller**             | 每个端点加 `@ApiOperation({ summary: '...', description: '...' })`                       |
| **Module**                 | 类 JSDoc `/** 模块职责 */`；`@Module({})` 中 imports/providers/exports 按字母排序        |

## 项目目录结构

```
server/src/
├── main.ts                   # 入口文件
├── app.module.ts             # 根模块
├── app.controller.ts         # 根 Controller（健康检查）
├── prisma/
│   ├── prisma.module.ts      # Prisma 全局模块
│   └── prisma.service.ts     # Prisma Client 封装
├── common/
│   ├── guards/               # 认证/授权守卫
│   ├── interceptors/         # 请求拦截器
│   ├── filters/              # 异常过滤器
│   ├── pipes/                # 管道校验
│   └── decorators/           # 自定义装饰器
├── config/
│   └── app.config.ts         # 应用配置
└── modules/
    └── {module}/
        ├── {module}.module.ts
        ├── {module}.controller.ts
        ├── {module}.service.ts
        ├── dto/
        │   ├── create-{entity}.dto.ts
        │   └── update-{entity}.dto.ts
        └── entities/
            └── {entity}.entity.ts   # Prisma 生成类型的二次封装（可选）
```

## 常见坑

| 场景           | 问题                                                 | 正确做法                                               |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| 循环依赖       | Module A imports Module B，Module B imports Module A | 用 `forwardRef(() => ModuleB)`                         |
| 异步初始化     | Service 的 `constructor` 中 await Prisma 连接        | 实现 `OnModuleInit` 接口，在 `onModuleInit()` 中初始化 |
| 环境变量直读   | `process.env.DB_URL` 在代码中硬编码                  | 通过 `ConfigService.get('DB_URL')` 读取                |
| DTO 缺少装饰器 | `class-validator` 装饰器缺失导致验证不生效           | 每个 DTO 字段同时加 `@ApiProperty()` 和验证装饰器      |
| 事务边界       | 事务内调用外部 HTTP 服务                             | Prisma `$transaction` 中禁止非数据库操作               |
