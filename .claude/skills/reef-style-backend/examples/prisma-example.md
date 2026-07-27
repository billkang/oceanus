# Prisma Service 与 Schema 示例

## Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// 系统用户
model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  active    Boolean  @default(true)
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}

/// 文章
model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)
  authorId  Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("posts")
}
```

## Prisma Module & Service

```typescript
// prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Prisma 全局模块
 * 作为 Global 模块，所有其他模块无需 imports 即可注入 PrismaService
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

```typescript
// prisma/prisma.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 数据库服务
 * 封装 PrismaClient，提供数据库连接生命周期管理
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database disconnected');
  }
}
```

## Prisma 查询最佳实践

```typescript
// 使用事务：多个原子操作
const [user, post] = await this.prisma.$transaction([
  this.prisma.user.create({ data: { name: 'Alice', email: 'alice@test.com' } }),
  this.prisma.post.create({ data: { title: 'Hello', content: 'World', authorId: 1 } }),
]);

// 使用 select 限制返回字段，避免 N+1
const users = await this.prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
    posts: {
      select: { title: true, published: true },
      where: { published: true },
    },
  },
});

// 使用 findFirstOrThrow 简化判空
const user = await this.prisma.user.findFirstOrThrow({
  where: { email: 'alice@test.com' },
});
```
