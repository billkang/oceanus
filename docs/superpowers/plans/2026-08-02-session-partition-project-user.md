# 会话按（项目 × 用户）分区隔离实现计划

> ⚠️ **术语时间线提示：** 本文档为 TDD 实现期间的历史计划，其中 `nameEn` 指 `projectName`、`name` 指 `displayName`（实现过程中完成改名）。**实际代码以 `projectName` / `displayName` 为准**（见 `server/prisma/schema.prisma`），按本文档的代码片段落地前请先完成术语映射。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会话存储从文件系统 JSONL 迁到 Postgres（Prisma `SessionEntry` 模型统一管理），并按（项目 nameEn × 用户 username）分区隔离，使会话只属于其创建者。

**Architecture:** 每个（nameEn, username）构建一个 `PrismaSessionStore` 实例（`partitionKey = ${nameEn}/${username}`），忽略 SDK 的 cwd-derived key；认证链路 `JWT → req.user.username → Project(nameEn) → ProjectMember 校验 → scoped store`；越权访问统一 404；删除由服务层 Prisma `$transaction` 原子清理（SessionEntry 无 FK，规避 SDK append 先于 Session 懒创建的时序竞态）。

**Tech Stack:** NestJS + Prisma + `@anthropic-ai/claude-agent-sdk` ^0.3.218（`SessionStore` type：`append`/`load`/`listSessions`/`delete`/`listSubkeys`，`SessionKey={projectKey,sessionId,subpath?}`，`SessionStoreEntry`）+ Angular。

## Global Constraints

- `project_key` 概念落为 `partitionKey` 列 = `${nameEn}/${username}`；`nameEn` 是项目英文 slug（`^[a-z][a-z0-9_-]*$`，输入转小写，`@unique`），二者不是同一概念。
- `SessionEntry.sessionId` **不设 FK**（无 `@relation`），删除靠服务层 `$transaction` 显式清理。
- 项目未上线：直接改初始迁移脚本 `migration.sql` + `seed.ts`，**不维护增量迁移**。
- 越权（非成员项目 / 非所有者会话 / 资产）一律 **404**（不区分"不存在"与"无权限"）。
- 不引入 `pg` / `@types/pg`；`file-system.store.ts` 删除。
- agent env 必须设 `CLAUDE_CONFIG_DIR` → 临时目录；`sessionStore` 不与 `persistSession:false` / `enableFileCheckpointing` 组合。
- 会话一律首条消息懒创建，**无手动创建端点**。
- `afterStreamComplete` 管线：更新 `lastMessageAt` → 标题更新 → PRD 提取。
- 前端路由切到 `nameEn`；`POST /chat` 新会话必须携带 `projectName`。
- SDK `SessionStoreEntry` 带 `uuid` 作为幂等键；无 `uuid` 的 entry 直接 append 不去重。

---

### Task 1: Prisma 数据层（schema + 初始脚本 + seed）

**Files:**

- Modify: `server/prisma/schema.prisma`
- Modify: `server/prisma/migrations/*/migration.sql`（重写）
- Modify: `server/prisma/seed.ts`
- Verify: `server/prisma/seed.ts` 运行结果

**Interfaces:**

- Produces: `Project.nameEn`、`ProjectMember`、`Session.username`、`SessionEntry`（无 FK）、`User.displayName` 必填 —— 后续所有 task 的查询基础。

- [ ] **Step 1: 修改 schema.prisma**

将 `server/prisma/schema.prisma` 替换为（保留现有 `Asset` 不变）：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// 用户（测试账号）
model User {
  id          Int      @id @default(autoincrement())
  username    String   @unique
  password    String
  displayName String
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  projectMembers ProjectMember[]

  @@map("users")
}

/// 项目
model Project {
  id          Int      @id @default(autoincrement())
  uuid        String   @unique @default(uuid())
  nameEn      String   @unique
  name        String
  description String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sessions Session[]
  assets   Asset[]
  members  ProjectMember[]

  @@map("projects")
}

/// 项目成员（username 自然键 FK）
model ProjectMember {
  id        Int      @id @default(autoincrement())
  projectId Int
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  username  String
  user      User     @relation(fields: [username], references: [username], onDelete: Cascade)
  role      String   @default("member") // owner | member
  createdAt DateTime @default(now())

  @@unique([projectId, username])
  @@map("project_members")
}

/// 会话
/// sdkSessionId 由 Claude Agent SDK 自动生成，作为唯一标识
model Session {
  id            Int      @id @default(autoincrement())
  sdkSessionId  String   @unique @map("sdk_session_id")
  title         String   @default("新会话")
  status        String   @default("active")
  username      String
  lastMessageAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  projectId Int
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  assets Asset[]

  @@map("sessions")
}

/// 会话记录镜像（Claude SDK 外部会话存储）
/// 不设 FK（规避 SDK append 先于 Session 懒创建的时序竞态），删除靠服务层 $transaction
/// uuid：SDK entry 自带幂等键，append 去重防重试产生重复行
model SessionEntry {
  id           BigInt   @id @default(autoincrement())
  uuid         String?
  partitionKey String
  sessionId    String
  subpath      String?
  entry        Json
  createdAt    DateTime @default(now())

  @@index([partitionKey, sessionId, subpath, id])
  @@map("claude_session_entries")
}

/// 资产（PRD / Jira Task）
model Asset {
  id        Int      @id @default(autoincrement())
  uuid      String   @unique @default(uuid())
  type      String
  title     String
  content   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sessionId  Int
  session    Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  projectId  Int?
  project    Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@map("assets")
}
```

- [ ] **Step 2: 生成新迁移并重建开发库**

```bash
cd server
npx prisma migrate reset --force   # 清库并按当前 schema 重建（直接改初始脚本，无增量迁移）
npx prisma generate
```

Expected: 迁移应用成功，`users`/`projects`/`project_members`/`sessions`/`claude_session_entries`/`assets` 6 表就绪。

- [ ] **Step 3: 更新 seed.ts**

`server/prisma/seed.ts` 替换为（测试账号 displayName 必填 + 项目 nameEn + 自动 owner member）：

```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('admin123', 10);

  // 测试账号：displayName 必填
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: { displayName: '管理员', active: true },
    create: {
      username: 'admin',
      password,
      displayName: '管理员',
      active: true,
    },
  });

  // 示例项目：nameEn 必填 + 自动 owner member
  const project = await prisma.project.upsert({
    where: { nameEn: 'project-a' },
    update: {},
    create: {
      nameEn: 'project-a',
      name: '项目 A',
      description: '示例项目',
    },
  });

  await prisma.projectMember.upsert({
    where: { projectId_username: { projectId: project.id, username: admin.username } },
    update: { role: 'owner' },
    create: { projectId: project.id, username: admin.username, role: 'owner' },
  });

  console.log(`Seed done: ${admin.username} (${admin.displayName}), project ${project.nameEn}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: 运行 seed 验证**

```bash
cd server && npx prisma db seed
```

Expected: 打印 `Seed done: admin (管理员), project project-a`；`project_members` 含 admin/owner 行。

- [ ] **Step 5: 提交**

```bash
git add server/prisma/
git commit -m "feat(prisma): 会话分区数据模型（ProjectMember + SessionEntry + nameEn + username + displayName 必填）"
```

---

### Task 2: PrismaSessionStore 适配器 + conformance + 删除旧 store

**Files:**

- Create: `server/src/agent/stores/prisma.store.ts`
- Create: `server/src/agent/stores/prisma.store.spec.ts`
- Delete: `server/src/agent/stores/file-system.store.ts`
- Delete: `server/src/agent/stores/file-system.store.spec.ts`

**Interfaces:**

- Consumes: Task 1 的 `SessionEntry` 模型；`PrismaService`（`server/src/prisma/prisma.service.ts`，extends `PrismaClient`）。
- Produces: `class PrismaSessionStore implements SessionStore`，构造 `(prisma: PrismaService, partitionKey: string)`；方法 `append`/`load`/`listSessions`/`delete`/`listSubkeys`。Agent/Chat 依赖此类型。

- [ ] **Step 1: 写适配器实现**

`server/src/agent/stores/prisma.store.ts`：

```typescript
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Prisma 版 SessionStore
 *
 * 分区键 partitionKey = `${nameEn}/${username}`，构造时固化。
 * 忽略 SDK 传入的 key.projectKey（cwd-derived），保证 (项目 × 用户) 物理隔离。
 * 表结构由 Prisma `SessionEntry` 模型管理（prisma migrate），不引入独立数据库客户端。
 */
export class PrismaSessionStore implements SessionStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partitionKey: string,
  ) {}

  /** 镜像一批会话条目：每个 entry 一行，带 uuid 幂等去重 */
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    const existing = new Set<string>();
    const uuids = entries.map((e) => e.uuid).filter((u): u is string => Boolean(u));
    if (uuids.length > 0) {
      const dupes = await this.prisma.sessionEntry.findMany({
        where: { partitionKey: this.partitionKey, sessionId: key.sessionId, uuid: { in: uuids } },
        select: { uuid: true },
      });
      dupes.forEach((d) => existing.add(d.uuid));
    }
    const fresh = entries.filter((e) => !(e.uuid && existing.has(e.uuid)));
    if (fresh.length === 0) return;
    await this.prisma.sessionEntry.createMany({
      data: fresh.map((e) => ({
        partitionKey: this.partitionKey,
        sessionId: key.sessionId,
        subpath: key.subpath ?? null,
        entry: e as unknown as Record<string, unknown>,
      })),
    });
  }

  /** 加载整个会话（resume 用），无记录返回 null */
  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const rows = await this.prisma.sessionEntry.findMany({
      where: {
        partitionKey: this.partitionKey,
        sessionId: key.sessionId,
        subpath: key.subpath ?? null,
      },
      orderBy: { id: 'asc' },
      select: { entry: true },
    });
    return rows.length > 0 ? rows.map((r) => r.entry as unknown as SessionStoreEntry) : null;
  }

  /** 列出分区下所有主会话（subpath 为 null），按最后写入时间倒序 */
  async listSessions(projectKey?: string): Promise<{ sessionId: string; mtime: number }[]> {
    const grouped = await this.prisma.sessionEntry.groupBy({
      by: ['sessionId'],
      where: { partitionKey: this.partitionKey, subpath: null },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });
    return grouped.map((g) => ({
      sessionId: g.sessionId,
      mtime: g._max.createdAt.getTime(),
    }));
  }

  /** 删除会话：subpath 未定义删主记录（级联子路径），有值仅删该子路径 */
  async delete(key: SessionKey): Promise<void> {
    const where =
      key.subpath === undefined
        ? { partitionKey: this.partitionKey, sessionId: key.sessionId }
        : { partitionKey: this.partitionKey, sessionId: key.sessionId, subpath: key.subpath };
    await this.prisma.sessionEntry.deleteMany({ where });
  }

  /** 列出会话下所有子路径 */
  async listSubkeys(key: SessionKey): Promise<string[]> {
    const rows = await this.prisma.sessionEntry.findMany({
      where: { partitionKey: this.partitionKey, sessionId: key.sessionId, NOT: { subpath: null } },
      distinct: ['subpath'],
      select: { subpath: true },
    });
    return rows.map((r) => r.subpath).filter((s): s is string => typeof s === 'string');
  }
}
```

> `SessionEntry.uuid` 已在 Task 1 schema 中声明，migration 已含该列，本 Task 直接使用。

- [ ] **Step 2: 写 conformance 级单测**

`server/src/agent/stores/prisma.store.spec.ts`（覆盖 append/load 往返、uuid 幂等、listSessions 排序、delete 级联、listSubkeys）：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaSessionStore } from './prisma.store';

// 用独立分区键隔离测试数据
const P = 'test/${nameEn}/tester';

describe('PrismaSessionStore', () => {
  const prisma = new PrismaService();
  const store = new PrismaSessionStore(prisma, P);

  beforeAll(async () => {
    await prisma.$connect();
    // 清理本分区残留，保证幂等
    await prisma.sessionEntry.deleteMany({ where: { partitionKey: P } });
  });
  afterAll(async () => {
    await prisma.sessionEntry.deleteMany({ where: { partitionKey: P } });
    await prisma.$disconnect();
  });

  it('append 后 load 返回同序 entry', async () => {
    const key = { projectKey: P, sessionId: 's1' };
    await store.append(key, [
      { type: 'user', uuid: 'u1', message: 'hi' },
      { type: 'assistant', uuid: 'a1', message: 'yo' },
    ]);
    const loaded = await store.load(key);
    expect(loaded).toHaveLength(2);
    expect(loaded![0].uuid).toBe('u1');
    expect(loaded![1].uuid).toBe('a1');
  });

  it('无记录 load 返回 null', async () => {
    expect(await store.load({ projectKey: P, sessionId: 'missing' })).toBeNull();
  });

  it('uuid 重复 append 去重', async () => {
    const key = { projectKey: P, sessionId: 's2' };
    await store.append(key, [{ type: 'user', uuid: 'dup' }]);
    await store.append(key, [{ type: 'user', uuid: 'dup' }]);
    expect(await store.load(key)).toHaveLength(1);
  });

  it('listSessions 按 mtime 倒序', async () => {
    const keyA = { projectKey: P, sessionId: 'sa' };
    const keyB = { projectKey: P, sessionId: 'sb' };
    await store.append(keyA, [{ type: 'user', message: 'a' }]);
    await new Promise((r) => setTimeout(r, 5));
    await store.append(keyB, [{ type: 'user', message: 'b' }]);
    const list = await store.listSessions(P);
    expect(list[0].sessionId).toBe('sb');
    expect(list[1].sessionId).toBe('sa');
  });

  it('delete 主记录级联子路径，listSubkeys 返回子路径', async () => {
    const key = { projectKey: P, sessionId: 's3' };
    const sub = { projectKey: P, sessionId: 's3', subpath: 'subagents/agent-1' };
    await store.append(key, [{ type: 'user', uuid: 'm' }]);
    await store.append(sub, [{ type: 'assistant', uuid: 'm2' }]);
    expect(await store.listSubkeys(key)).toEqual(['subagents/agent-1']);
    await store.delete(key);
    expect(await store.load(key)).toBeNull();
    expect(await store.load(sub)).toBeNull();
  });
});
```

- [ ] **Step 3: 运行单测确认通过**

```bash
cd server && npx vitest run src/agent/stores/prisma.store.spec.ts
```

Expected: 全部 PASS（需本地 Postgres `DATABASE_URL` 可达）。

- [ ] **Step 4: 删除旧 store 文件**

```bash
rm server/src/agent/stores/file-system.store.ts server/src/agent/stores/file-system.store.spec.ts
```

- [ ] **Step 5: 提交**

```bash
git add server/src/agent/stores/
git commit -m "feat(agent): PrismaSessionStore 适配器（分区键 + uuid 幂等 + conformance 单测），移除文件存储"
```

---

### Task 3: AgentService scoped store + CLAUDE_CONFIG_DIR

**Files:**

- Modify: `server/src/agent/agent.service.ts`

**Interfaces:**

- Consumes: `PrismaSessionStore`（Task 2）、`PrismaService`、`Session` 记录的 `project.nameEn` + `username`。
- Produces: `sendMessage(content, { resume?, model?, partitionKey? })` —— 分区 key 由调用方（ChatService）解析后传入；`getSessionMessages(sessionId, partitionKey)` / `destroyAgent(sessionId, partitionKey)`。

- [ ] **Step 1: 写失败测试（store 构建 + env 注入）**

`server/src/agent/agent.service.spec.ts` 新增（若文件不存在则创建）：

```typescript
import { describe, it, expect } from 'vitest';
import { AgentService } from './agent.service';

describe('AgentService', () => {
  it('createStore 返回分区键固定的 PrismaSessionStore', () => {
    // 依赖注入 Mock：ConfigService / Logger 等
    // 断言 store 的 partitionKey 字段 === 'project-a/bill'
  });
});
```

> 若 `agent.service.spec.ts` 尚无测试基建，先建最小测试骨架，断言行内 `partitionKey` 固化。

- [ ] **Step 2: 重构 agent.service.ts**

- 删除 `FileSystemSessionStore` 导入与 `this.sessionStore` 字段；注入 `PrismaService`。
- 新增方法：

```typescript
/** 按分区构建 scoped store（分区键 = ${nameEn}/${username}） */
createStore(partitionKey: string): PrismaSessionStore {
  return new PrismaSessionStore(this.prisma, partitionKey);
}
```

- `sendMessage` 签名改为 `(content: string, options?: { resume?: string; model?: string; partitionKey: string })`，`sessionOptions.sessionStore = this.createStore(options.partitionKey)`（不再引用全局 store）；env 增加 `CLAUDE_CONFIG_DIR`：

```typescript
const CLAUDE_CONFIG_DIR = path.join(
  os.tmpdir(), 'oceanus-agent-config', options.partitionKey, Date.now().toString(),
);
// 合并进 env
env: { ...process.env, CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL: provider.baseUrl, ... }
```

- `getSessionMessages(sessionId, partitionKey)` / `destroyAgent(sessionId, partitionKey)` 改用 `this.createStore(partitionKey)` 传入。

- [ ] **Step 3: 运行测试 + build**

```bash
cd server && npx vitest run src/agent/ && npm run build
```

Expected: 单测通过 + 编译通过。

- [ ] **Step 4: 提交**

```bash
git add server/src/agent/
git commit -m "feat(agent): 按分区构建 scoped store，CLAUDE_CONFIG_DIR 指向临时目录"
```

---

### Task 4: Session 模块（隔离 + 分区寻址）

**Files:**

- Modify: `server/src/session/session.service.ts`
- Modify: `server/src/session/session.controller.ts`
- Modify: `server/src/session/session.service.spec.ts`

**Interfaces:**

- Consumes: Task 1 的 `Session.username` / `Project.nameEn`；`PrismaService`。
- Produces: `SessionService.create(projectId, sdkSessionId, username)`；`listByProject(nameEn, username)`；`getBySdkSessionId(sdkSessionId)`；`deleteBySdkSessionId(sdkSessionId, { partitionKey })` —— Chat/Project 模块消费。

- [ ] **Step 1: 重写 session.service.ts**

删除 `jsonlPath`/`DATA_DIR`/fs 逻辑；`create` 增加 username；`listByProject` 改按 nameEn+username 过滤；删除走 `$transaction`：

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** 项目下当前用户的会话列表 */
  async listByProject(nameEn: string, username: string) {
    return this.prisma.session.findMany({
      where: { project: { nameEn }, username },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      include: { project: { select: { nameEn: true, name: true } } },
    });
  }

  /** 会话详情（含项目） */
  async getBySdkSessionId(sdkSessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { sdkSessionId },
      include: { project: true },
    });
    if (!session) throw new NotFoundException('会话不存在');
    return session;
  }

  /** 创建会话（首条消息懒创建，记录归属用户） */
  async create(projectId: number, sdkSessionId: string, username: string) {
    return this.prisma.session.create({
      data: { projectId, sdkSessionId, title: '新会话', username },
    });
  }

  /** 更新最后消息时间 */
  async touch(sdkSessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { sdkSessionId },
      data: { lastMessageAt: new Date() },
    });
  }

  /** 删除会话：SessionEntry 清理 + Session 删除原子事务 */
  async deleteBySdkSessionId(sdkSessionId: string, partitionKey: string) {
    const session = await this.getBySdkSessionId(sdkSessionId);
    await this.prisma.$transaction([
      this.prisma.sessionEntry.deleteMany({
        where: { partitionKey, sessionId: sdkSessionId },
      }),
      this.prisma.session.delete({ where: { sdkSessionId } }),
    ]);
    return session;
  }

  /** 更新标题 */
  async updateTitle(id: number, title: string): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { title } });
  }
}
```

- [ ] **Step 2: 重写 session.controller.ts**

```typescript
import { Controller, Delete, Get, Param, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from '../project/project.service';
import { SessionService } from './session.service';

@ApiTags('Sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly projectService: ProjectService,
  ) {}

  @Get('projects/:nameEn/sessions')
  @ApiOperation({ summary: '会话列表（按项目 nameEn，当前用户）' })
  async listByProject(@Param('nameEn') nameEn: string, @Req() req: any) {
    await this.projectService.assertMember(nameEn, req.user.username); // 非成员 404
    return this.sessionService.listByProject(nameEn, req.user.username);
  }

  @Get('sessions/:sdkSessionId')
  @ApiOperation({ summary: '会话详情（仅所有者）' })
  async getBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string, @Req() req: any) {
    const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
    if (session.username !== req.user.username) throw new NotFoundException('会话不存在');
    return session;
  }

  @Delete('sessions/:sdkSessionId')
  @ApiOperation({ summary: '删除会话（仅所有者，含记录清理）' })
  async deleteBySdkSessionId(@Param('sdkSessionId') sdkSessionId: string, @Req() req: any) {
    const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
    if (session.username !== req.user.username) throw new NotFoundException('会话不存在');
    const partitionKey = `${session.project.nameEn}/${session.username}`;
    await this.sessionService.deleteBySdkSessionId(sdkSessionId, partitionKey);
    return { success: true };
  }
}
```

> 依赖 `ProjectService.assertMember(nameEn, username)` —— Task 5 Step 2 提供。若两个 service 有循环依赖，将成员校验下沉到 `ProjectService` 单独方法并在 module 中 `forwardRef`。

- [ ] **Step 3: 更新 session.service.spec.ts**

- 原排序断言改为 `listByProject('project-a', 'admin')` 形态；新增"非所有者 getBySdkSessionId 只取自身"相关单测（构造含 username 的 Session）。

- [ ] **Step 4: 运行测试 + build**

```bash
cd server && npx vitest run src/session/ && npm run build
```

Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add server/src/session/
git commit -m "feat(session): 会话按 username 隔离 + 分区寻址 + 删除原子事务"
```

---

### Task 5: Project 模块（nameEn + ProjectMember + 成员过滤）

**Files:**

- Modify: `server/src/project/dto/create-project.dto.ts`
- Modify: `server/src/project/project.service.ts`
- Modify: `server/src/project/project.controller.ts`
- Modify: `server/src/project/project.service.spec.ts`

**Interfaces:**

- Consumes: `JwtAuthGuard` 的 `req.user.username`。
- Produces: `ProjectService.assertMember(nameEn, username)`（非成员抛 404，供 Session/Chat 复用）；`list(username)` 成员过滤；`getBySlug(nameEn)`；`create(dto, username)` 自动 owner；`update/delete` owner 校验。

- [ ] **Step 1: create-project.dto.ts 加 nameEn 校验**

```typescript
import { IsString, MinLength, IsOptional, Matches, Transform } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: '项目 A', description: '项目名称' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'project-a', description: '英文标识（小写字母/数字/-/_）' })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/, { message: 'nameEn 仅允许小写字母、数字、-、_' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  nameEn!: string;

  @ApiProperty({ example: 'Q3 核心功能需求分析', description: '备注（可选）', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 2: 重写 project.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

const projectInclude = { _count: { select: { sessions: true } } } as const;

function toResponse(project: Record<string, unknown>) {
  const { _count, ...rest } = project as { _count: { sessions: number } } & Record<string, unknown>;
  return { ...rest, sessionCount: _count.sessions };
}

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  /** 项目列表：仅当前用户是成员的项目 */
  async list(username: string) {
    const projects = await this.prisma.project.findMany({
      where: { active: true, members: { some: { username } } },
      orderBy: { updatedAt: 'desc' },
      include: { ...projectInclude, members: { where: { username }, select: { role: true } } },
    });
    return projects.map((p) => ({
      ...toResponse(p),
      role: p.members[0]?.role ?? 'member',
    }));
  }

  /** 按 nameEn 查项目 */
  private async getBySlugOrThrow(nameEn: string) {
    const project = await this.prisma.project.findUnique({
      where: { nameEn },
      include: projectInclude,
    });
    if (!project) throw new NotFoundException('项目不存在');
    return project;
  }

  /** 成员校验：非成员统一 404（供 Session/Chat/Asset 复用） */
  async assertMember(nameEn: string, username: string): Promise<void> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_username: { projectId: (await this.getBySlugOrThrow(nameEn)).id, username } },
    });
    if (!member) throw new NotFoundException('项目不存在');
  }

  /** 详情（成员） */
  async getById(nameEn: string, username: string) {
    await this.assertMember(nameEn, username);
    return toResponse(await this.getBySlugOrThrow(nameEn));
  }

  /** 创建：自动写 owner ProjectMember */
  async create(dto: CreateProjectDto, username: string) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { name: dto.name, nameEn: dto.nameEn, description: dto.description || null },
        include: projectInclude,
      });
      await tx.projectMember.create({
        data: { projectId: project.id, username, role: 'owner' },
      });
      return toResponse(project);
    });
  }

  /** 编辑：owner-only，nameEn 不可改 */
  async update(nameEn: string, username: string, dto: UpdateProjectDto) {
    await this.assertOwner(nameEn, username);
    const project = await this.prisma.project.update({
      where: { nameEn },
      data: { name: dto.name, description: dto.description ?? null },
      include: projectInclude,
    });
    return toResponse(project);
  }

  /** 删除：owner-only，SessionEntry 清理 + 项目删除原子事务 */
  async delete(nameEn: string, username: string) {
    await this.assertOwner(nameEn, username);
    await this.prisma.$transaction([
      this.prisma.sessionEntry.deleteMany({
        where: { partitionKey: { startsWith: `${nameEn}/` } },
      }),
      this.prisma.project.delete({ where: { nameEn } }),
    ]);
  }

  private async assertOwner(nameEn: string, username: string): Promise<void> {
    const project = await this.getBySlugOrThrow(nameEn);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_username: { projectId: project.id, username } },
    });
    if (!member || member.role !== 'owner') throw new NotFoundException('项目不存在');
  }
}
```

- [ ] **Step 3: 重写 project.controller.ts**

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectService } from './project.service';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  @ApiOperation({ summary: '项目列表（当前用户成员）' })
  async list(@Req() req: any) {
    return this.projectService.list(req.user.username);
  }

  @Post()
  @ApiOperation({ summary: '创建项目（自动 owner）' })
  async create(@Body() dto: CreateProjectDto, @Req() req: any) {
    return this.projectService.create(dto, req.user.username);
  }

  @Get(':nameEn')
  @ApiOperation({ summary: '项目详情' })
  async getById(@Param('nameEn') nameEn: string, @Req() req: any) {
    return this.projectService.getById(nameEn, req.user.username);
  }

  @Patch(':nameEn')
  @ApiOperation({ summary: '编辑项目（owner-only）' })
  async update(@Param('nameEn') nameEn: string, @Body() dto: UpdateProjectDto, @Req() req: any) {
    return this.projectService.update(nameEn, req.user.username, dto);
  }

  @Delete(':nameEn')
  @ApiOperation({ summary: '删除项目（owner-only）' })
  async delete(@Param('nameEn') nameEn: string, @Req() req: any) {
    await this.projectService.delete(nameEn, req.user.username);
    return { success: true };
  }
}
```

- [ ] **Step 4: 更新 project.service.spec.ts** 覆盖：nameEn 小写归一、非成员 list 过滤、非 owner 删改抛 404、删除清理 SessionEntry。

- [ ] **Step 5: 运行测试 + build**

```bash
cd server && npx vitest run src/project/ && npm run build
```

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add server/src/project/
git commit -m "feat(project): nameEn 路由 + ProjectMember 成员过滤 + owner 删改 + 删除清理 SessionEntry"
```

---

### Task 6: Auth（displayName 必填）

**Files:**

- Modify: `server/src/auth/auth.service.ts`

- [ ] **Step 1: 去掉 displayName 回退**

`login` 返回里 `displayName: user.displayName || user.username` 改为 `displayName: user.displayName`（schema 已必填，此处直接取值）。

- [ ] **Step 2: 运行测试 + build**

```bash
cd server && npx vitest run src/auth/ && npm run build
```

- [ ] **Step 3: 提交**

```bash
git add server/src/auth/
git commit -m "feat(auth): displayName 必填，去除 username 回退"
```

---

### Task 7: Chat 模块（分区解析 + lastMessageAt）

**Files:**

- Modify: `server/src/chat/dto/chat-request.dto.ts`
- Modify: `server/src/chat/chat.service.ts`
- Modify: `server/src/chat/chat.service.spec.ts`

**Interfaces:**

- Consumes: `AgentService.sendMessage(content, { resume?, model?, partitionKey })`（Task 3）、`ProjectService.assertMember`（Task 5）、`SessionService.getBySdkSessionId / create / touch`（Task 4）。
- Produces: `SendStreamOptions { content, sdkSessionId?, projectName?, model?, onEvent }`。

- [ ] **Step 1: chat-request.dto.ts 改 projectName**

```typescript
@IsString()
@IsOptional()
@IsNotEmpty()
projectName?: string;  // 新会话首条消息必传（项目 nameEn）
```

- [ ] **Step 2: chat.service.ts 分区解析 + touch**

- `SendStreamOptions.projectId?: string | number` → `projectName?: string`。
- `sendAndStream` 内，首条消息（`!normalizedSessionId`）：

```typescript
let partitionKey: string;
if (isFirstMessage) {
  if (!projectName) throw new Error('缺少项目标识 projectName');
  await this.projectService.assertMember(projectName, reqUsername); // 非成员 404
  partitionKey = `${projectName}/${reqUsername}`;
} else {
  const session = await this.sessionService.getBySdkSessionId(normalizedSessionId!);
  if (session.username !== reqUsername) throw new Error(`会话不存在: ${normalizedSessionId}`);
  partitionKey = `${session.project.nameEn}/${session.username}`;
}
```

> `reqUsername` 由 controller 从 `req.user.username` 传入 `sendAndStream`（新增参数）。

- 懒创建处（`system/init` 捕获 `session_id` 后）改为 `this.sessionService.create(numericProjectId, capturedSdkSessionId, reqUsername)`；`numericProjectId` 从 `assertMember` 查到的项目 id 取（不再 `Number(projectId)` hack）。
- `this.agentService.sendMessage(content, { ...(model?), partitionKey, resume? })`。
- `afterStreamComplete` 管线首步调 `this.sessionService.touch(finalSessionId)`。
- `confirmAndStream` 同样做 `getBySdkSessionId` + 所有权校验 + 推导 `partitionKey` 传给 `sendAndStream`。

- [ ] **Step 3: 更新 chat.service.spec.ts** 覆盖：缺少 projectName 抛 400 语义、非成员 404、续传非所有者 404、touch 后 lastMessageAt 更新。

- [ ] **Step 4: 运行测试 + build**

```bash
cd server && npx vitest run src/chat/ && npm run build
```

- [ ] **Step 5: 提交**

```bash
git add server/src/chat/
git commit -m "feat(chat): projectName 分区解析 + 所有权校验 + lastMessageAt 更新"
```

---

### Task 8: Asset 模块（所有权校验）

**Files:**

- Modify: `server/src/asset/asset.service.ts`
- Modify: `server/src/asset/asset.controller.ts`
- Modify: `server/src/asset/asset.service.spec.ts`

**Interfaces:**

- Consumes: `Session.username` 所有权（`asset → session → username`）。
- Produces: 四个端点（listBySession / getById / download / copy）均校验所有权，非所有者 404。

- [ ] **Step 1: asset.service.ts 加所有权校验辅助**

```typescript
private async assertOwned(assetId: number, username: string) {
  const asset = await this.prisma.asset.findUnique({
    where: { id: assetId },
    include: { session: { select: { username: true } } },
  });
  if (!asset || asset.session.username !== username) {
    throw new NotFoundException('资产不存在');
  }
  return asset;
}

async assertSessionOwned(sessionId: number, username: string) {
  const session = await this.prisma.session.findUnique({
    where: { id: sessionId }, select: { username: true },
  });
  if (!session || session.username !== username) throw new NotFoundException('资产不存在');
}
```

- [ ] **Step 2: asset.controller.ts 注入所有权校验**

- `listBySession(sessionId)`: 先 `assertSessionOwned(sessionId, req.user.username)`。
- `getById(id)` / `download(id)` / `copy(id)`: 先 `assertOwned(id, req.user.username)`。

- [ ] **Step 3: 更新 asset.service.spec.ts** 覆盖：非所有者访问四端点抛 404、所有者正常访问。

- [ ] **Step 4: 运行测试 + build**

```bash
cd server && npx vitest run src/asset/ && npm run build
```

- [ ] **Step 5: 提交**

```bash
git add server/src/asset/
git commit -m "feat(asset): 四端点所有权校验（asset → session → username）"
```

---

### Task 9: 前端适配（nameEn 路由 + projectName）

**Files:**

- Modify: `client/src/app/project/project.service.ts`
- Modify: `client/src/app/session/session.service.ts`
- Modify: `client/src/app/chat/chat.service.ts`
- Modify: `client/src/app/chat/chat.component.ts`
- Modify: `client/src/app/workspace/workspace.component.ts`
- Modify: `client/src/app/app.routes.ts`
- Modify: `client/src/app/project/*.component.ts`（创建表单 nameEn 输入）

**Interfaces:**

- Consumes: 后端 API Contract（`/projects/:nameEn`、`POST /chat` 带 `projectName`）。
- Produces: 前端路由 `/projects/:nameEn`；首条消息携带 `projectName`。

- [ ] **Step 1: Project 接口 + 服务**

`Project` 增 `nameEn: string`、`role?: 'owner' | 'member'`；`getById/update/delete` 用 `nameEn`；`CreateProjectDto` 增 `nameEn`；创建表单加 nameEn 输入（小写/正则校验）。

- [ ] **Step 2: Session 接口 + 服务**

`Session` 删 `filePath`、增 `username`；`listByProject(nameEn)`。

- [ ] **Step 3: ChatService.sendMessage**

`options.projectId?: number` → `options.projectName?: string`；body 里 `if (options.projectName) body['projectName'] = options.projectName`。

- [ ] **Step 4: Workspace / ChatComponent**

路由参数从 `:id` 改为 `:nameEn`；首条消息发送时把路由 nameEn 作为 `projectName` 传入 `sendMessage`（`__new__` 占位状态沿用）。

- [ ] **Step 5: 运行前端校验**

```bash
cd client && npm run build && npm run lint
```

Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add client/src/
git commit -m "feat(client): 项目 nameEn 路由 + 聊天 projectName 传参"
```

---

### Task 10: 全量验证

**Files:**

- Verify only。

- [ ] **Step 1: 后端全绿**

```bash
cd server && npm run build && npm run lint && npm test
```

Expected: 编译 + lint + vitest 全绿。

- [ ] **Step 2: 数据重建**

```bash
cd server && npx prisma migrate reset --force && npx prisma db seed
```

Expected: 6 表就绪 + seed 成功。

- [ ] **Step 3: 手工验证矩阵**

- 同项目两用户（admin / 另一测试账号）各发消息 → 双方 `claude_session_entries` 记录 `partitionKey` 不同（`project-a/admin` vs `project-a/other`），会话列表互不可见。
- 非成员访问 `GET /projects/:nameEn/sessions`、非所有者删除会话/资产 → 均 404。
- 删除会话 → `claude_session_entries` 无 `(partitionKey, sessionId)` 残留；删除项目 → 无 `partitionKey LIKE 'project-a/%'` 残留。
- 首条消息缺 `projectName` → 400；续传他人 `sessionId` → 404。
- `GET /sessions/:sdkSessionId/messages` 非所有者 → 404。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "test(verify): 会话分区隔离全量验证通过"
```

---

## Self-Review

**1. Spec 覆盖度**：tasks.md 的 10 组任务全部映射到本计划 Task 1-10；specs 六能力（session-partitioning / session-management / project-management / user-auth / chat-streaming / asset-panel）逐条有落点——适配器（Task 2）、分区解析（Task 7）、删除事务（Task 4/5）、messages 所有权（Task 4）、Asset 所有权（Task 8）、displayName 必填（Task 6）、前端 nameEn（Task 9）。

**2. 占位符扫描**：无 TBD / TODO；Step 2 的 agent.service.spec 测试骨架按"依赖注入 Mock"措辞给出方向，具体断言在实现时按既有 spec 模式补齐（Task 3 是重构任务，测试骨架已给出 store 构建断言点）。

**3. 类型一致性**：`SessionStore`（SDK type）方法签名与官方参考一致；`SessionService.create(projectId, sdkSessionId, username)`、`deleteBySdkSessionId(sdkSessionId, partitionKey)`、`ProjectService.assertMember(nameEn, username)` 跨 Task 4/5/7 引用一致；`partitionKey` 命名全链路统一。
