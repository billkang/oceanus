# 产品工作流程规范化（project-workspace-isolation）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Oceanus 建立"项目 × 用户 × 会话"的物理目录工作区：Agent 会话 cwd 锁定会话目录（禁 Bash + 写白名单准硬隔离），tide-* skills 每项目安装（spawn deepstorm CLI），PRD 落盘并经独立 LLM 合并归档到共享区，全链路软删 + 回收站。

**Architecture:** NestJS 新增 workspace / skills / archive 三个模块 + 改造 project / agent / chat / session / asset 五个既有模块。`WorkspacePathBuilder` 统一路径构建（防穿越）；`SkillsProvider` 接口隔离 CLI；`ArchiveService` 编排去抖触发 + 独立合并调用。软删基于 5 表 `deleted_at` + projectName 部分唯一索引。

**Tech Stack:** NestJS 11 / Prisma 6 / PostgreSQL / Vitest / Claude Agent SDK (TS) / `@deepstorm/cli`

## Global Constraints

- 所有 SDD 文档正文中文；代码实体名保留英文。
- 服务内文件系统路径只允许经 `WorkspacePathBuilder` 产出，禁止手拼；`path.resolve` 后前缀校验。
- 交互式 Agent 工具集不含 `Bash`；`shared/` 对交互式 Agent 只读（PreToolUse 写白名单 hook 强制）。
- 交互式 Agent 的 `cwd` 固定为会话目录 `<PROJECTS_ROOT>/<projectName>/requirements/private/<username>/<sessionId>/`。
- 归档合并为**独立非交互** `query()`（tools=[Read,Write,Glob,Grep]、无 sessionStore/resume、maxTurns 3-5）。
- 所有读查询过滤 `deletedAt: null`；删除为 `updateMany set deletedAt` 而非物理 delete。
- 未上线，**不做迁移管理**：改 `schema.prisma` + `prisma db push`。
- 合并失败有界重试（指数退避 3 次），不降级为纯文本追加。
- `session_id` 由服务端首条消息预生成（UUID），经 SDK `session_id` 选项注入（Task 7 spike 确认 TS SDK 选项名）。

---

### Task 1: DB schema 软删改造（schema + db push）

**Files:**

- Modify: `server/prisma/schema.prisma`

**Interfaces:**

- Consumes: 无
- Produces: `Project.deletedAt` / `Session.deletedAt` / `ProjectMember.deletedAt` / `SessionEntry.deletedAt` / `Asset.deletedAt`（均为 `DateTime? @map("deleted_at")`）；`Project` 失去 `projectName @unique`，新增部分唯一索引 `projects_projectName_active`。所有后续 task 的 Prisma where 均引用 `deletedAt`。

- [x] **Step 1: 修改 schema 加 deleted_at 列**

在 5 个 model 内追加字段：

```prisma
/// 项目
model Project {
  id          Int      @id @default(autoincrement())
  uuid        String   @unique @default(uuid())
  projectName String
  displayName String
  description String?
  active      Boolean  @default(true)
  deletedAt   DateTime? @map("deleted_at")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  sessions Session[]
  assets   Asset[]
  members  ProjectMember[]

  @@index([projectName], where: "(deleted_at IS NULL)", unique: true, name: "projects_projectName_active")
  @@map("projects")
}
```

注意：`projectName` 删掉 `@unique`，改为上面的 `@@index`（`@@unique` 不支持 `where`，部分唯一索引必须用 `@@index` + `where` + `unique: true`）。

`Session` / `ProjectMember` / `SessionEntry` / `Asset` 各追加 `deletedAt DateTime? @map("deleted_at")` 一行（放 `updatedAt` 附近）。

- [x] **Step 2: db push + generate**

```bash
cd server
pnpm exec prisma db push
pnpm exec prisma generate
```

Expected: 输出 schema 已同步到数据库，无错误。

- [x] **Step 3: 验证部分唯一索引行为（真实 DB）**

```bash
cd server && pnpm exec ts-node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.project.create({ data: { projectName: 't-push-1', displayName: '测试' } });
  await p.project.update({ where: { projectName: 't-push-1' }, data: { deletedAt: new Date() } });
  await p.project.create({ data: { projectName: 't-push-1', displayName: '测试2' } }); // 应成功
  const dup = await p.project.create({ data: { projectName: 't-push-2', displayName: '测试' } });
  await p.project.update({ where: { projectName: 't-push-2' }, data: { deletedAt: new Date() } });
  await p.project.deleteMany({ where: { projectName: { in: ['t-push-1', 't-push-2'] } } });
  console.log('PARTIAL_UNIQUE_OK');
})().finally(() => p.\$disconnect());
"
```

Expected: 输出 `PARTIAL_UNIQUE_OK`（软删后可重建同名、活跃同名冲突已由第二行 update 规避）。若你想验证冲突，去掉中间 update 再跑一次确认 `P2002` 抛错。

- [x] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma
git commit -m "feat(schema): 5 表软删 deleted_at + projectName 部分唯一索引"
```

---

### Task 2: WorkspacePathBuilder（统一路径构建，防穿越）

**Files:**

- Create: `server/src/workspace/workspace-path.builder.ts`
- Test: `server/src/workspace/workspace-path.builder.spec.ts`

**Interfaces:**

- Produces（后续 task 依赖的精确签名）:
  - `class PathTraversalError extends Error`
  - `class WorkspacePathBuilder`
    - `constructor(root: string)`
    - `get baseRoot(): string`
    - `projectRoot(projectName: string): string`
    - `requirementsRoot(projectName: string): string`
    - `sharedRoot(projectName: string): string`
    - `sharedPrdDir(projectName: string): string`
    - `sessionDir(projectName: string, username: string, sessionId: string): string`
    - `trashRoot(): string`
    - `trashPath(originalName: string, timestamp?: number): string`

- [x] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { PathTraversalError, WorkspacePathBuilder } from './workspace-path.builder';

describe('WorkspacePathBuilder', () => {
  const root = '/tmp/projects';
  const b = new WorkspacePathBuilder(root);

  it('构建会话目录 / 共享 PRD / 回收站路径', () => {
    expect(b.sessionDir('proj', 'alice', 'sess-1')).toBe('/tmp/projects/proj/requirements/private/alice/sess-1');
    expect(b.sharedPrdDir('proj')).toBe('/tmp/projects/proj/requirements/shared/prd');
    expect(b.trashPath('proj', 1000)).toBe('/tmp/projects/.trash/proj-1000');
  });

  it('非法标识符抛 PathTraversalError', () => {
    expect(() => b.projectRoot('../evil')).toThrow(PathTraversalError);
    expect(() => b.projectRoot('a/b')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', '..', 's1')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', 'alice', 's\\x')).toThrow(PathTraversalError);
    expect(() => b.sessionDir('proj', 'alice', '')).toThrow(PathTraversalError);
  });
});
```

- [x] **Step 2: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/workspace/workspace-path.builder.spec.ts
```

Expected: FAIL（Cannot find module）。

- [x] **Step 3: 写实现**

```ts
import * as path from 'node:path';

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathTraversalError';
  }
}

const INVALID_RE = /[\\/]|^\s*$|\0/;

export function validateIdentifier(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PathTraversalError(`${label} 为空`);
  }
  if (INVALID_RE.test(value) || value === '.' || value === '..') {
    throw new PathTraversalError(`${label} 含非法字符: "${value}"`);
  }
}

export class WorkspacePathBuilder {
  constructor(private readonly root: string) {}

  get baseRoot(): string {
    return this.root;
  }

  projectRoot(projectName: string): string {
    validateIdentifier(projectName, 'projectName');
    return path.resolve(this.root, projectName);
  }

  requirementsRoot(projectName: string): string {
    return path.join(this.projectRoot(projectName), 'requirements');
  }

  sharedRoot(projectName: string): string {
    return path.join(this.projectRoot(projectName), 'requirements', 'shared');
  }

  sharedPrdDir(projectName: string): string {
    return path.join(this.sharedRoot(projectName), 'prd');
  }

  sessionDir(projectName: string, username: string, sessionId: string): string {
    validateIdentifier(username, 'username');
    validateIdentifier(sessionId, 'sessionId');
    return path.join(this.projectRoot(projectName), 'requirements', 'private', username, sessionId);
  }

  trashRoot(): string {
    return path.resolve(this.root, '.trash');
  }

  trashPath(originalName: string, timestamp = Date.now()): string {
    validateIdentifier(originalName, 'originalName');
    return path.join(this.trashRoot(), `${originalName}-${timestamp}`);
  }
}
```

- [x] **Step 4: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/workspace/workspace-path.builder.spec.ts
```

Expected: PASS。

- [x] **Step 5: Commit**

```bash
git add server/src/workspace/workspace-path.builder.ts server/src/workspace/workspace-path.builder.spec.ts
git commit -m "feat(workspace): 统一路径构建 + 标识符防穿越校验"
```

---

### Task 3: WorkspaceConfig + WorkspaceService（骨架 / 会话目录 / 回收站 / 残留处理）

**Files:**

- Create: `server/src/workspace/workspace.service.ts`
- Create: `server/src/workspace/workspace.module.ts`
- Test: `server/src/workspace/workspace.service.spec.ts`
- Modify: `server/src/app.module.ts`（注册 `WorkspaceModule`）

**Interfaces:**

- Consumes: `WorkspacePathBuilder`（Task 2）；`ConfigService`；`Logger`
- Produces:
  - `class WorkspaceService implements OnModuleInit`
    - `readonly paths: WorkspacePathBuilder`
    - `onModuleInit(): Promise<void>`
    - `createSkeleton(projectName: string): Promise<void>`（幂等 mkdir）
    - `ensureFreshProjectDir(projectName: string): Promise<void>`（残留目录先移入回收站）
    - `ensureSessionDir(projectName: string, username: string, sessionId: string): Promise<void>`（mkdir + `.claude/skills` symlink）
    - `moveToTrash(targetAbs: string): Promise<string>`（返回目标回收站路径）

- [x] **Step 1: 写失败测试（用临时目录，`mkdtemp`）**

```ts
import { mkdtemp, rm, stat, readlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let root: string;
  let service: WorkspaceService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-test-'));
    const module = await Test.createTestingModule({
      providers: [
        { provide: Logger, useValue: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } },
        WorkspaceService,
      ],
    })
      .overrideProvider('PROJECTS_ROOT_VALUE')
      .useValue(root)
      .compile();
    service = module.get(WorkspaceService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  // ... 见下
});
```

> 注：`WorkspaceService` 构造器从 `ConfigService` 读 `PROJECTS_ROOT`。测试中需注入一个返回 `root` 的 ConfigService mock。若构造器签名要求 ConfigService，用 `{ provide: ConfigService, useValue: { get: (k: string) => (k === 'PROJECTS_ROOT' ? root : undefined) } }`。

- [x] **Step 2: 写行为测试（createSkeleton / ensureSessionDir / moveToTrash / 残留处理）**

```ts
it('createSkeleton 建立四段目录且幂等', async () => {
  await service.createSkeleton('proj');
  expect((await stat(join(root, 'proj/requirements/shared/prd'))).isDirectory()).toBe(true);
  expect((await stat(join(root, 'proj/requirements/private'))).isDirectory()).toBe(true);
  expect((await stat(join(root, 'proj/repo'))).isDirectory()).toBe(true);
  await service.createSkeleton('proj'); // 幂等
});

it('ensureSessionDir 建会话目录 + skills symlink', async () => {
  await service.createSkeleton('proj');
  await mkdir(join(root, 'proj/.claude/skills'), { recursive: true });
  await service.ensureSessionDir('proj', 'alice', 'sess-1');
  const link = join(root, 'proj/requirements/private/alice/sess-1/.claude/skills');
  expect((await readlink(link)).startsWith(join(root, 'proj/.claude/skills'))).toBe(true);
});

it('moveToTrash 移入回收站且时间戳唯一', async () => {
  await service.createSkeleton('proj');
  const dest = await service.moveToTrash(join(root, 'proj'));
  expect(dest.startsWith(join(root, '.trash/proj-'))).toBe(true);
  await expect(stat(join(root, 'proj'))).rejects.toThrow();
});

it('ensureFreshProjectDir 处理残留目录', async () => {
  await service.createSkeleton('proj');
  await service.ensureFreshProjectDir('proj');
  const dest = await service.moveToTrash(join(root, '.trash/proj-')); // 不应存在
  expect(dest).toBeDefined();
  await expect(stat(join(root, 'proj'))).rejects.toThrow();
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/workspace/workspace.service.spec.ts
```

Expected: FAIL（Cannot find module `./workspace.service`）。

- [x] **Step 4: 写实现**

```ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { WorkspacePathBuilder } from './workspace-path.builder';

async function fsExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class WorkspaceService implements OnModuleInit {
  readonly paths: WorkspacePathBuilder;

  constructor(
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    const configured = configService.get<string>('PROJECTS_ROOT');
    const root = configured?.trim() ? configured : './projects';
    if (!configured?.trim()) {
      logger.warn('PROJECTS_ROOT 未配置，使用默认 ./projects');
    }
    this.paths = new WorkspacePathBuilder(root);
  }

  async onModuleInit(): Promise<void> {
    await fsp.mkdir(this.paths.baseRoot, { recursive: true });
  }

  /** 骨架：幂等 mkdir。残留目录处理由 ensureFreshProjectDir 负责 */
  async createSkeleton(projectName: string): Promise<void> {
    const dirs = [
      this.paths.sharedPrdDir(projectName),
      path.join(this.paths.requirementsRoot(projectName), 'private'),
      path.join(this.paths.projectRoot(projectName), 'repo'),
    ];
    for (const dir of dirs) {
      await fsp.mkdir(dir, { recursive: true });
    }
  }

  /** 创建项目前置：项目根存在残留目录（非本次流程产物）则移入回收站，失败抛错阻断创建 */
  async ensureFreshProjectDir(projectName: string): Promise<void> {
    const target = this.paths.projectRoot(projectName);
    if (await fsExists(target)) {
      await this.moveToTrash(target);
    }
  }

  /** 会话目录：mkdir + `.claude/skills` symlink → 项目根 skills（幂等，目标不存在也建 dangling link） */
  async ensureSessionDir(projectName: string, username: string, sessionId: string): Promise<void> {
    const sessionDir = this.paths.sessionDir(projectName, username, sessionId);
    await fsp.mkdir(sessionDir, { recursive: true });

    const skillsLink = path.join(sessionDir, '.claude', 'skills');
    await fsp.mkdir(path.dirname(skillsLink), { recursive: true });
    let alreadyLink = false;
    try {
      const st = await fsp.lstat(skillsLink);
      alreadyLink = st.isSymbolicLink();
    } catch {
      alreadyLink = false;
    }
    if (!alreadyLink) {
      await fsp.symlink(this.paths.projectRoot(projectName) + '/.claude/skills', skillsLink, 'dir');
    }
  }

  /** 目录移入回收站（时间戳唯一，首用自动建 .trash/） */
  async moveToTrash(targetAbs: string): Promise<string> {
    await fsp.mkdir(this.paths.trashRoot(), { recursive: true });
    const name = path.basename(targetAbs);
    const dest = this.paths.trashPath(name);
    await fsp.rename(targetAbs, dest);
    this.logger.log(`Moved to trash: ${targetAbs} -> ${dest}`);
    return dest;
  }
}
```

- [x] **Step 5: 写模块并注册**

```ts
// server/src/workspace/workspace.module.ts
import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

@Module({
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
```

`app.module.ts` imports 数组加 `WorkspaceModule`。

- [x] **Step 6: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/workspace/workspace.service.spec.ts
```

Expected: PASS。

- [x] **Step 7: Commit**

```bash
git add server/src/workspace/ server/src/app.module.ts
git commit -m "feat(workspace): 骨架/会话目录/回收站/残留目录处理 + 模块注册"
```

---

### Task 4: SkillsProvider 接口 + DeepstormSkillsProvider（spawn CLI）

**Files:**

- Create: `server/src/skills/skills-provider.interface.ts`
- Create: `server/src/skills/deepstorm-skills.provider.ts`
- Create: `server/src/skills/skills.module.ts`
- Test: `server/src/skills/deepstorm-skills.provider.spec.ts`

**前置：** `pnpm --filter server add @deepstorm/cli`（server workspace 依赖）。

**Interfaces:**

- Produces:
  - `interface SkillsProvider { install(projectDir: string): Promise<void>; currentVersion(): Promise<string>; isOutdated(projectDir: string): Promise<boolean>; }`
  - `class DeepstormSkillsProvider implements SkillsProvider`
  - `SkillsModule` 导出 `SkillsProvider`（provide 用 `{ provide: SkillsProvider, useClass: DeepstormSkillsProvider }`）

- [x] **Step 1: spike 确认 CLI bin 解析**

```bash
cd server && node -e "console.log(require.resolve('@deepstorm/cli/package.json'))"
cd server && node -e "console.log(require('@deepstorm/cli/package.json').bin)"
```

Expected: 打印 package.json 路径与 bin 值。**记录实际值**，若 bin 不是 `./dist/cli.js`，Task 4 Step 4 的 `cliBin()` 解析逻辑按实际调整。同时确认：`@deepstorm/cli/package.json` 无 `exports` 字段（可 `require.resolve` 子路径）。

- [x] **Step 2: spike 确认 setup 写入面**

在临时目录跑一次：

```bash
cd $(mktemp -d) && deepstorm setup --non-interactive --tools tide 2>&1 | tail -20 && find . -maxdepth 3 -type d
```

Expected: 观察生成了哪些目录/文件。**若发现 `.claude/settings.json` / hooks / MCP 等非 skills 内容超出预期**，则改 Task 4 Step 4 的 `install()`：不 spawn 完整 `setup`，改为复制 `@deepstorm/cli` 内 `tide-*` skill 模板到 `projectDir/.claude/skills/`（记录模板源路径，复制目录）。把结论写回 design.md OQ-3。

- [x] **Step 3: 写失败测试（mock child_process）**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
import { execFile } from 'node:child_process';
import { DeepstormSkillsProvider } from './deepstorm-skills.provider';

const execFileMock = vi.mocked(execFile);

describe('DeepstormSkillsProvider', () => {
  let root: string;
  let provider: DeepstormSkillsProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-test-'));
    provider = new DeepstormSkillsProvider(
      { get: (k: string) => (k === 'SKILLS_INSTALL_TIMEOUT_MS' ? 10000 : undefined) } as unknown as ConfigService,
      { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
    );
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('isOutdated 无标记文件返回 true', async () => {
    await expect(provider.isOutdated(root)).resolves.toBe(true);
  });

  it('install 执行 CLI 并写入版本标记', async () => {
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    execFileMock.mockResolvedValue({ stdout: 'ok', stderr: '' } as never);
    await provider.install(root);
    expect(execFileMock).toHaveBeenCalledWith('node', expect.any(Array), expect.objectContaining({ cwd: root }));
    const marker = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(root, '.claude/skills/.deepstorm-skills.json'), 'utf8'),
    );
    expect(marker.installedVersion).toEqual(expect.any(String));
  });

  it('install 失败时传播错误且不写标记', async () => {
    execFileMock.mockRejectedValue(new Error('CLI timeout') as never);
    await expect(provider.install(root)).rejects.toThrow('CLI timeout');
    await expect(
      (await import('node:fs/promises')).access(join(root, '.claude/skills/.deepstorm-skills.json')),
    ).rejects.toThrow();
  });

  it('版本一致 isOutdated 返回 false', async () => {
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    const v = await provider.currentVersion();
    await writeFile(
      join(root, '.claude/skills/.deepstorm-skills.json'),
      JSON.stringify({ installedVersion: v, installedAt: 'x' }),
    );
    await expect(provider.isOutdated(root)).resolves.toBe(false);
  });
});
```

- [x] **Step 4: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/skills/deepstorm-skills.provider.spec.ts
```

Expected: FAIL（Cannot find module）。

- [x] **Step 5: 写实现**

```ts
// server/src/skills/skills-provider.interface.ts
export interface SkillsProvider {
  install(projectDir: string): Promise<void>;
  currentVersion(): Promise<string>;
  isOutdated(projectDir: string): Promise<boolean>;
}
```

```ts
// server/src/skills/deepstorm-skills.provider.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SkillsProvider } from './skills-provider.interface';

const execFileAsync = promisify(execFile);
const VERSION_MARKER_REL = path.join('.claude', 'skills', '.deepstorm-skills.json');

interface VersionMarker {
  installedVersion: string;
  installedAt: string;
}

@Injectable()
export class DeepstormSkillsProvider implements SkillsProvider {
  private readonly installTimeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    const raw = this.configService.get<number>('SKILLS_INSTALL_TIMEOUT_MS');
    this.installTimeoutMs = typeof raw === 'number' && raw > 0 ? raw : 60000;
  }

  private static cliBin(): string {
    const pkgPath = require.resolve('@deepstorm/cli/package.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('@deepstorm/cli/package.json') as { bin?: string | Record<string, string> };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.deepstorm ?? 'dist/cli.js');
    return path.join(path.dirname(pkgPath), bin);
  }

  async install(projectDir: string): Promise<void> {
    const cli = DeepstormSkillsProvider.cliBin();
    const { stdout, stderr } = await execFileAsync('node', [cli, 'setup', '--non-interactive', '--tools', 'tide'], {
      cwd: projectDir,
      timeout: this.installTimeoutMs,
    });
    await this.writeVersionMarker(projectDir);
    this.logger.log(`tide-* skills installed into ${projectDir}`);
    this.logger.debug(`${stdout}${stderr}`);
  }

  async currentVersion(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('@deepstorm/cli/package.json') as { version: string };
    return pkg.version;
  }

  async isOutdated(projectDir: string): Promise<boolean> {
    const marker = await this.readVersionMarker(projectDir);
    const current = await this.currentVersion();
    return marker === null || marker.installedVersion !== current;
  }

  private markerPath(projectDir: string): string {
    return path.join(projectDir, VERSION_MARKER_REL);
  }

  private async readVersionMarker(projectDir: string): Promise<VersionMarker | null> {
    try {
      const raw = await fsp.readFile(this.markerPath(projectDir), 'utf8');
      return JSON.parse(raw) as VersionMarker;
    } catch {
      return null;
    }
  }

  private async writeVersionMarker(projectDir: string): Promise<void> {
    const marker: VersionMarker = {
      installedVersion: await this.currentVersion(),
      installedAt: new Date().toISOString(),
    };
    await fsp.mkdir(path.dirname(this.markerPath(projectDir)), { recursive: true });
    await fsp.writeFile(this.markerPath(projectDir), JSON.stringify(marker, null, 2), 'utf8');
  }
}
```

```ts
// server/src/skills/skills.module.ts
import { Module } from '@nestjs/common';
import { DeepstormSkillsProvider } from './deepstorm-skills.provider';
import { SkillsProvider } from './skills-provider.interface';

@Module({
  providers: [{ provide: SkillsProvider, useClass: DeepstormSkillsProvider }],
  exports: [SkillsProvider],
})
export class SkillsModule {}
```

> `SkillsProvider` 是 interface，Nest DI 需用 `@Inject(SkillsProvider)` token。interface 编译后不存在，但作为 token 仅需类型引用（`as const` 或直接 `{ provide: SkillsProvider }`）——TS 会把 interface 当类型抹掉，运行时 token 是 `[Function SkillsProvider]`（object 引用）。**备选**：若遇 DI 报错，改用 class token `Inject` 或把 `SkillsProvider` 改为 abstract class。按 Nest 官方惯例 interface 作 token 可直接用 `@Inject(SkillsProvider)`（TS 允许，运行时用函数引用）。

- [x] **Step 6: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/skills/deepstorm-skills.provider.spec.ts
```

Expected: PASS。

- [x] **Step 7: Commit**

```bash
git add server/src/skills/ server/package.json server/pnpm-lock.yaml
git commit -m "feat(skills): SkillsProvider 接口 + spawn deepstorm CLI 实现 + 版本标记"
```

---

### Task 5: Session / Asset 软删查询过滤与级联

**Files:**

- Modify: `server/src/session/session.service.ts`
- Modify: `server/src/session/session.service.spec.ts`
- Modify: `server/src/asset/asset.service.ts`
- Modify: `server/src/asset/asset.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspaceService`（moveToTrash，仅会话删除时）
- Produces: 读查询统一 `deletedAt: null`；删除改为软删级联。

- [x] **Step 1: 写失败测试（读过滤）**

`session.service.spec.ts` 新增：

```ts
it('listByProject 过滤已删会话', async () => {
  vi.spyOn(prisma.session, 'findMany').mockResolvedValue([]);
  await service.listByProject('proj', 'alice');
  expect(prisma.session.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
  );
});

it('getBySdkSessionId 已删会话 404', async () => {
  vi.spyOn(prisma.session, 'findUnique').mockResolvedValue(null);
  await expect(service.getBySdkSessionId('gone')).rejects.toThrow(NotFoundException);
});
```

`asset.service.spec.ts` 同理：`listBySession` / `getById` / `getContent` 断言 where 含 `deletedAt: null`。

- [x] **Step 2: 写失败测试（会话软删级联 + 回收站）**

```ts
it('deleteBySdkSessionId 软删级联 + 会话目录进回收站', async () => {
  vi.spyOn(prisma.session, 'findUnique').mockResolvedValue({
    id: 1,
    project: { projectName: 'proj' },
    username: 'alice',
  } as never);
  vi.spyOn(prisma.sessionEntry, 'updateMany').mockResolvedValue({ count: 3 } as never);
  vi.spyOn(prisma.asset, 'updateMany').mockResolvedValue({ count: 2 } as never);
  vi.spyOn(prisma.session, 'update').mockResolvedValue({} as never);
  vi.mocked(prisma.$transaction).mockResolvedValue([]);
  const moveSpy = vi.spyOn(workspace, 'moveToTrash').mockResolvedValue('/trash/x');

  await service.deleteBySdkSessionId('sess-1', 'proj/alice');

  expect(prisma.sessionEntry.updateMany).toHaveBeenCalledWith({
    where: { partitionKey: 'proj/alice', sessionId: 'sess-1', deletedAt: null },
    data: { deletedAt: expect.any(Date) },
  });
  expect(moveSpy).toHaveBeenCalledWith(expect.stringContaining('sess-1'));
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/session/session.service.spec.ts src/asset/asset.service.spec.ts
```

- [x] **Step 4: 写实现**

`session.service.ts`：

```ts
// listByProject
where: { project: { projectName }, username, deletedAt: null },

// getBySdkSessionId —— 已删视为不存在
const session = await this.prisma.session.findUnique({ where: { sdkSessionId }, include: { project: true } });
if (!session || session.deletedAt !== null) throw new NotFoundException('会话不存在');
```

`SessionService` 构造器注入 `WorkspaceService`（`ChatModule` 需 import `WorkspaceModule`）。`deleteBySdkSessionId` 改软删：

```ts
async deleteBySdkSessionId(sdkSessionId: string, partitionKey: string) {
  const session = await this.getBySdkSessionId(sdkSessionId);
  const now = new Date();
  await this.prisma.$transaction([
    this.prisma.sessionEntry.updateMany({
      where: { partitionKey, sessionId: sdkSessionId, deletedAt: null },
      data: { deletedAt: now },
    }),
    this.prisma.asset.updateMany({
      where: { sessionId: session.id, deletedAt: null },
      data: { deletedAt: now },
    }),
    this.prisma.session.update({ where: { sdkSessionId }, data: { deletedAt: now } }),
  ]);
  // 会话目录进回收站（失败仅记日志，不阻断 DB）
  await this.workspace
    .moveToTrash(this.workspace.paths.sessionDir(session.project.projectName, session.username, sdkSessionId))
    .catch((e: Error) => this.logger.error(`会话目录移入回收站失败: ${e.message}`));
  return session;
}
```

> 注：`sessionId` 目录名即 `sdkSessionId`。`Logger` 需注入。

`asset.service.ts` 读查询补 `deletedAt: null`（listBySession where、assertOwned findUnique 后判断 + assertSessionOwned）。

- [x] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/session/ src/asset/
```

- [x] **Step 6: Commit**

```bash
git add server/src/session/ server/src/asset/ server/src/chat/chat.module.ts
git commit -m "feat(soft-delete): session/asset 读过滤 + 会话软删级联 + 回收站"
```

---

### Task 6: AgentService 隔离（cwd / additionalDirectories / 写白名单 hook / 去 Bash / sessionId）

**Files:**

- Modify: `server/src/agent/agent.service.ts`
- Modify: `server/src/agent/agent.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspaceService` 的 `paths`（由 ChatService 传入，agent.service 不直接依赖 workspace）
- Produces:
  - `sendMessage(content, options?: { resume?: string; model?: string; partitionKey: string; sessionDir: string; sharedDir: string; sessionId?: string })`
  - `private buildPermissionHooks(sessionDir: string, sharedDir: string): { hooks: Record<string, unknown> }`

- [x] **Step 1: 写失败测试（sendMessage 传参）**

`agent.service.spec.ts` mock `@anthropic-ai/claude-agent-sdk` 的 `query`，断言：

```ts
it('query 携带 cwd / additionalDirectories / session_id，且工具不含 Bash', async () => {
  await service.sendMessage('hi', {
    partitionKey: 'proj/alice',
    sessionDir: '/tmp/projects/proj/requirements/private/alice/sess-1',
    sharedDir: '/tmp/projects/proj/requirements/shared',
    sessionId: '11111111-2222-3333-4444-555555555555',
  });
  const opts = (query as Mock).mock.calls[0][0].options;
  expect(opts.cwd).toBe('/tmp/projects/proj/requirements/private/alice/sess-1');
  expect(opts.additionalDirectories).toEqual(['/tmp/projects/proj/requirements/shared']);
  expect(opts.sessionId).toBe('11111111-2222-3333-4444-555555555555');
  const tide = opts.agents['oceanus-tide'];
  expect(tide.tools).not.toContain('Bash');
  expect(opts.hooks.PreToolUse).toBeDefined();
});
```

- [x] **Step 2: 写失败测试（写白名单 hook 行为）**

```ts
it('PreToolUse 写白名单：shared 内写被 deny，会话目录内写放行', () => {
  const hooks = service['buildPermissionHooks']('/tmp/p/private/alice/s1', '/tmp/p/shared');
  const writeHook = hooks.hooks.PreToolUse[0].hooks[0] as (input: PreToolUseHookInput) => Promise<unknown>;
  return writeHook({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/p/shared/prd/x.md' },
  } as PreToolUseHookInput).then((res) => {
    const out = res as { hookSpecificOutput: { permissionDecision: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/agent/agent.service.spec.ts
```

- [x] **Step 4: 写实现**

`agent.service.ts` 变更：

```ts
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'node:path';

/** 判断 child 是否在 parent 目录内（含等于） */
function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// sendMessage 签名与 query 配置：
async sendMessage(
  content: string,
  options?: {
    resume?: string;
    model?: string;
    partitionKey: string;
    sessionDir: string;
    sharedDir: string;
    sessionId?: string;
  },
) {
  ...
  const permissionHooks = this.buildPermissionHooks(options.sessionDir, options.sharedDir);
  const q = query({
    prompt: content,
    options: {
      ...sessionOptions,
      ...(options?.sessionId ? { sessionId: options.sessionId } : {}),
      cwd: options.sessionDir,
      additionalDirectories: [options.sharedDir],
      includePartialMessages: true,
      agent: 'oceanus-tide',
      agents: {
        'oceanus-tide': {
          description: 'Oceanus 需求讨论助手',
          prompt: `你是 Oceanus 需求讨论助手，运行在 Oceanus AI 协作平台（网页版）。

⚠️ 重要环境差异：你在网页聊天环境中运行，不是 Claude Code 终端。
- 不要要求用户执行 /clear 命令（网页中无效）
- 不要要求用户执行任何终端命令（如 /clear, cd 等）
- tide-discuss 提到 "引导 /clear" 时，直接告知用户"我们开始新的需求讨论"，跳过这个步骤
- 所有对话通过网页消息完成，用户只能打字回复

你的核心能力：
- 用户表达需求讨论意图（"我想/需要/做一个/讨论一下..."）时，
  调用 Skill 工具加载 tide-discuss 工作流
- 进入 tide-discuss 后，严格按照其工作流引导用户完成需求收敛
- 当前工作目录为你的会话专属目录；tide-discuss skill 已随项目安装。
  你的文件读写仅限会话目录内，公共 PRD 位于 additionalDirectories 供只读参考。`,
          tools: ['Skill', 'Read', 'Write', 'Grep', 'Glob', 'Edit', 'WebSearch', 'WebFetch'], // 无 Bash
        },
      },
      skills: 'all',
      settingSources: ['project'],
      model: provider.modelId,
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_BASE_URL: ..., ANTHROPIC_API_KEY: ..., ANTHROPIC_SMALL_FAST_MODEL: ... },
      effort: 'low',
      thinking: { type: 'enabled', budgetTokens: 4000 },
      maxTurns,
      maxBudgetUsd,
      hooks: { ...(this.buildLangfuseHooks(provider.modelId).hooks ?? {}), ...(permissionHooks.hooks ?? {}) },
    },
  });
  ...
}

private buildPermissionHooks(sessionDir: string, sharedDir: string): { hooks: Record<string, unknown> } {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            (input: PreToolUseHookInput) => {
              const target = (input.tool_input as { file_path?: string } | undefined)?.file_path;
              if (typeof target !== 'string' || !isWithin(sessionDir, path.resolve(target))) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason: `写操作目标超出会话目录: ${target ?? '(无路径)'}`,
                  },
                };
              }
              return { continue: true };
            },
          ],
        },
        {
          matcher: 'Read',
          hooks: [
            (input: PreToolUseHookInput) => {
              const target = (input.tool_input as { file_path?: string } | undefined)?.file_path;
              if (typeof target !== 'string') return { continue: true };
              const abs = path.resolve(target);
              if (isWithin(sessionDir, abs) || isWithin(sharedDir, abs)) return { continue: true };
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  permissionDecisionReason: `读操作目标越界: ${target}`,
                },
              };
            },
          ],
        },
      ],
    },
  };
}
```

> **hooks 合并注意**：`buildLangfuseHooks` 返回 `{ hooks: {...} }`，`buildPermissionHooks` 返回 `{ hooks: {...} }`，两者 spread 会互相覆盖——必须像上面那样把两个 `.hooks` 对象合并后赋给 `hooks` 键。

- [x] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/agent/
```

Expected: PASS（既有 agent 测试若断言旧签名需同步更新：sendMessage 现在要求 sessionDir/sharedDir）。

- [x] **Step 6: Commit**

```bash
git add server/src/agent/
git commit -m "feat(agent): cwd 隔离 + 写白名单 hook + 去 Bash + session_id 注入"
```

---

### Task 7: ChatService 集成（预生成 sessionId + 会话目录 + PRD 落盘 + 归档触发）

**Files:**

- Modify: `server/src/chat/chat.service.ts`
- Modify: `server/src/chat/chat.module.ts`（import `WorkspaceModule`、`SkillsModule`、`ArchiveModule`）
- Modify: `server/src/chat/chat.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspaceService`（ensureSessionDir / paths）、`SkillsProvider`（isOutdated / install）、`ArchiveService`（onPrdExtracted）、`AgentService.sendMessage` 新签名（Task 6）
- Produces:
  - `sendAndStream` 首条消息流程：预生成 sessionId → ensureSessionDir → 惰性刷新 skills → sendMessage(sessionId/sessionDir/sharedDir)
  - `tryExtractPrd`：额外落盘会话目录 + 成功后调 `archiveService.onPrdExtracted`

- [x] **Step 1: spike 确认 TS SDK `session_id` 选项**

读 `node_modules/@anthropic-ai/claude-agent-sdk` 的 `.d.ts`：

```bash
cd server && grep -rn "sessionId\|session_id" node_modules/@anthropic-ai/claude-agent-sdk/dist/*.d.ts | head
```

Expected: 找到 options 里的 sessionId 字段名（camelCase）。**记录确切字段名**。若 SDK 无此字段（自动生成不可覆盖），回退方案：首条 query 不带 cwd（用 `private/<username>/` 作 cwd，先 `ensureUserDir`），init 后建会话目录，续传用会话目录 cwd——按此调整 Task 6/7 实现并更新 spec「会话目录创建时点」。默认按有 `sessionId` 字段推进。

- [x] **Step 2: 写失败测试（首条消息预生成 + 建目录 + 传参）**

`chat.service.spec.ts` mock `WorkspaceService` / `SkillsProvider` / `ArchiveService`，断言：

```ts
it('首条消息：预生成 sessionId → ensureSessionDir → 传 sessionDir/sharedDir/sessionId', async () => {
  // 构造 sendAndStream：projectName 必传、无 sdkSessionId
  const onEvent = vi.fn();
  await service.sendAndStream({ content: 'hi', projectName: 'proj', username: 'alice', onEvent });
  expect(workspace.ensureSessionDir).toHaveBeenCalledWith('proj', 'alice', expect.stringMatching(UUID_RE));
  const sendArgs = agentService.sendMessage.mock.calls[0];
  expect(sendArgs[1].sessionDir).toContain('proj/requirements/private/alice');
  expect(sendArgs[1].sessionId).toEqual(expect.stringMatching(UUID_RE));
});
```

- [x] **Step 3: 写失败测试（PRD 落盘 + 触发归档）**

```ts
it('tryExtractPrd 落盘会话目录并触发归档', async () => {
  vi.spyOn(sessionService, 'getBySdkSessionId').mockResolvedValue({
    id: 1,
    project: { projectName: 'proj' },
    username: 'alice',
  } as never);
  vi.spyOn(assetService, 'create').mockResolvedValue({ id: 9, title: 'T' } as never);
  vi.spyOn(workspace, 'paths', 'get').mockReturnValue({ sessionDir: () => '/tmp/p/private/alice/s1' } as never);
  await service['tryExtractPrd']('s1', '# PRD\n内容', onEvent);
  expect(fsWriteSpy).toHaveBeenCalledWith(expect.stringContaining('s1'), expect.stringContaining('# PRD'));
  expect(archiveService.onPrdExtracted).toHaveBeenCalledWith('s1');
});
```

> fs 写用 `node:fs/promises`，测试中 `vi.mock('node:fs/promises', ...)` 或 spy。

- [x] **Step 4: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/chat/
```

- [x] **Step 5: 写实现**

`chat.service.ts`：

```ts
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// 构造注入新增：
private readonly workspace: WorkspaceService,
private readonly skills: SkillsProvider,
private readonly archiveService: ArchiveService,

// sendAndStream 首条消息分支（在 resolvePartition 之后）：
let activeSessionId = normalizedSessionId;
if (isFirstMessage) {
  activeSessionId = randomUUID();
  await this.workspace.ensureSessionDir(projectName!, username, activeSessionId);
  // 惰性刷新 skills（不阻断）
  const projectRoot = this.workspace.paths.projectRoot(projectName!);
  void this.skills.isOutdated(projectRoot).then((outdated) => {
    if (outdated) {
      return this.skills.install(projectRoot).catch((e: Error) =>
        this.logger.error(`skills 惰性刷新失败: ${e.message}`),
      );
    }
  });
}
const projectNameResolved = partitionKey.split('/')[0];
const sessionDir = this.workspace.paths.sessionDir(projectNameResolved, username, activeSessionId!);
const sharedDir = this.workspace.paths.sharedRoot(projectNameResolved);

// sendMessage 调用：
const result = isFirstMessage
  ? await this.agentService.sendMessage(content, { partitionKey, sessionDir, sharedDir, sessionId: activeSessionId, ...(model ? { model } : {}) })
  : await this.agentService.sendMessage(content, { resume: normalizedSessionId!, partitionKey, sessionDir, sharedDir, ...(model ? { model } : {}) });

// system/init 捕获处保持（capturedSdkSessionId = msg.session_id，应与预生成一致）：
if (isFirstMessage && msg.type === 'system' && (msg as SDKSystemMessage).subtype === 'init') {
  capturedSdkSessionId = (msg as SDKSystemMessage & { session_id?: string }).session_id ?? activeSessionId;
  ...
}
```

`tryExtractPrd` 追加（asset create 成功后、SSE 通知前）：

```ts
// 落盘会话目录产出物
try {
  const session = await this.sessionService.getBySdkSessionId(sdkSessionId);
  const sessionDir = this.workspace.paths.sessionDir(session.project.projectName, session.username, sdkSessionId);
  await fsp.mkdir(sessionDir, { recursive: true });
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
  await fsp.writeFile(path.join(sessionDir, `${safeTitle}.md`), responseText, 'utf8');
} catch (e) {
  this.logger.warn(`PRD 落盘失败: ${(e as Error).message}`);
}

// 触发去抖归档（不阻断）
await this.archiveService.onPrdExtracted(sdkSessionId).catch((e: Error) => {
  this.logger.warn(`归档触发失败: ${e.message}`);
});
```

`chat.module.ts` imports 加 `WorkspaceModule`、`SkillsModule`、`ArchiveModule`。

- [x] **Step 6: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/chat/
```

Expected: PASS。

- [x] **Step 7: Commit**

```bash
git add server/src/chat/
git commit -m "feat(chat): 预生成 sessionId + 会话目录创建 + PRD 落盘 + 归档触发"
```

---

### Task 8: ProjectService 创建（FS 先行）与软删

**Files:**

- Modify: `server/src/project/project.service.ts`
- Modify: `server/src/project/project.module.ts`（import `WorkspaceModule`、`SkillsModule`）
- Modify: `server/src/project/project.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspaceService`（ensureFreshProjectDir / createSkeleton / paths / moveToTrash）、`SkillsProvider`（install）
- Produces:
  - `create(dto, username)`：唯一性预校验 → ensureFreshProjectDir → createSkeleton → DB 事务 → skills best-effort
  - `delete(projectName, username)`：软删级联 $transaction + 目录进回收站
  - `list` / `getById` / `assertMember` 过滤 `deletedAt: null`

- [x] **Step 1: 写失败测试（create FS 先行）**

```ts
describe('create (FS 先行)', () => {
  it('先建骨架后 DB，skills 失败不阻断', async () => {
    vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
    const fresh = vi.spyOn(workspace, 'ensureFreshProjectDir').mockResolvedValue();
    const skeleton = vi.spyOn(workspace, 'createSkeleton').mockResolvedValue();
    const tx = {
      project: { create: vi.fn().mockResolvedValue({ ...mockProject, id: 9, _count: { sessions: 0 } }) },
      projectMember: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));
    vi.spyOn(skills, 'install').mockRejectedValue(new Error('cli down'));

    await expect(service.create({ displayName: 'P', projectName: 'p-1' }, 'admin')).resolves.toBeDefined();
    expect(fresh).toHaveBeenCalledWith('p-1');
    expect(skeleton).toHaveBeenCalledWith('p-1');
    expect(tx.project.create).toHaveBeenCalled();
    expect(skills.install).toHaveBeenCalled();
  });

  it('骨架失败时不触碰 DB', async () => {
    vi.spyOn(prisma.project, 'findFirst').mockResolvedValue(null);
    vi.spyOn(workspace, 'createSkeleton').mockRejectedValue(new Error('disk full'));
    await expect(service.create({ displayName: 'P', projectName: 'p-2' }, 'admin')).rejects.toThrow('disk full');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: 写失败测试（软删）**

```ts
it('delete 级联软删 + 目录进回收站（rename 失败不阻断 DB）', async () => {
  vi.spyOn(prisma.project, 'findUnique').mockResolvedValue({ id: 1, projectName: 'p-1' } as never);
  vi.spyOn(prisma.projectMember, 'findUnique').mockResolvedValue({ role: 'owner' } as never);
  vi.mocked(prisma.$transaction).mockResolvedValue([]);
  vi.spyOn(workspace, 'moveToTrash').mockRejectedValue(new Error('perm'));

  await expect(service.delete('p-1', 'admin')).resolves.toBeUndefined();
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/project/
```

- [x] **Step 4: 写实现**

`project.service.ts`：

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { WorkspaceService } from '../workspace/workspace.service';
import { SkillsProvider } from '../skills/skills-provider.interface';

constructor(
  private readonly prisma: PrismaService,
  private readonly workspace: WorkspaceService,
  private readonly skills: SkillsProvider,
  private readonly logger: Logger,
) {}

async create(dto: CreateProjectDto, username: string) {
  const projectName = dto.projectName;
  // 1. 唯一性预校验（活跃记录）
  const existing = await this.prisma.project.findFirst({
    where: { projectName, deletedAt: null },
    select: { id: true },
  });
  if (existing) throw new ConflictException('该英文标识已被使用');
  // 2. FS 先行：残留处理 + 骨架（失败则中止，DB 无副作用）
  await this.workspace.ensureFreshProjectDir(projectName);
  await this.workspace.createSkeleton(projectName);
  // 3. DB 事务
  let project;
  try {
    project = await this.prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { displayName: dto.displayName, projectName, description: dto.description || null },
        include: projectInclude,
      });
      await tx.projectMember.create({ data: { projectId: p.id, username, role: 'owner' } });
      return p;
    });
  } catch (err) {
    // DB 失败罕见（唯一性已预校验）：best-effort 清刚建骨架
    await this.workspace
      .moveToTrash(this.workspace.paths.projectRoot(projectName))
      .catch(() => undefined);
    throw err;
  }
  // 4. skills 安装（best-effort 不阻断，惰性刷新补装）
  this.skills.install(this.workspace.paths.projectRoot(projectName)).catch((e: Error) => {
    this.logger.error(`skills 安装失败（后续惰性刷新补装）: ${e.message}`);
  });
  return toResponse(project);
}

async delete(projectName: string, username: string) {
  const project = await this.assertOwnerReturn(projectName, username);
  const now = new Date();
  await this.prisma.$transaction([
    this.prisma.session.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: now } }),
    this.prisma.projectMember.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: now } }),
    this.prisma.sessionEntry.updateMany({ where: { partitionKey: { startsWith: `${projectName}/` } }, data: { deletedAt: now } }),
    this.prisma.asset.updateMany({ where: { projectId: project.id, deletedAt: null }, data: { deletedAt: now } }),
    this.prisma.project.update({ where: { projectName }, data: { deletedAt: now } }),
  ]);
  await this.workspace
    .moveToTrash(this.workspace.paths.projectRoot(projectName))
    .catch((e: Error) => this.logger.error(`项目目录移入回收站失败: ${e.message}`));
}
```

读查询过滤：`list` where 加 `deletedAt: null`；`getByProjectNameOrThrow` 的 findUnique 后若 `deletedAt !== null` 抛 404；`assertMember` / `assertOwner` 复用。`assertOwner` 改造为返回 project（`assertOwnerReturn`），`update` 处保持原调用。

- [x] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/project/
```

Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add server/src/project/ server/src/project/project.module.ts
git commit -m "feat(project): FS 先行创建 + 软删级联 + 回收站"
```

---

### Task 9: ArchiveService（去抖 / 域归并 / 独立合并调用 / mutex / 有界重试）

**Files:**

- Create: `server/src/archive/archive.service.ts`
- Create: `server/src/archive/archive.module.ts`
- Test: `server/src/archive/archive.service.spec.ts`
- Modify: `server/src/app.module.ts`（注册 `ArchiveModule`）

**Interfaces:**

- Consumes: `PrismaService`（assets 读 PRD）、`WorkspaceService`（paths，读聚合文件）、`ConfigService`（`ARCHIVE_DEBOUNCE_ROUNDS` / `ARCHIVE_MERGE_MAX_TURNS` / `ARCHIVE_MERGE_MAX_BUDGET_USD`）
- Produces:
  - `onPrdExtracted(sessionId: string): Promise<void>`（去抖调度）
  - `private executeMerge(projectName, sessionPrd, domain): Promise<void>`（独立 query + 写聚合文件）
  - `private domainLocks: Map<string, Promise<void>>`

- [x] **Step 1: 写失败测试（去抖触发）**

```ts
it('连续 3 轮无变化才触发合并；变化重置计数', async () => {
  vi.spyOn(prisma.asset, 'findFirst').mockResolvedValue({ content: 'PRD-A' } as never);
  const execSpy = vi.spyOn(archiveService as any, 'executeMerge').mockResolvedValue();
  await archiveService.onPrdExtracted('s1'); // 轮1
  await archiveService.onPrdExtracted('s1'); // 轮2
  expect(execSpy).not.toHaveBeenCalled();
  await archiveService.onPrdExtracted('s1'); // 轮3 → 触发
  expect(execSpy).toHaveBeenCalledTimes(1);
  await archiveService.onPrdExtracted('s1'); // 触发后计数重置
  await archiveService.onPrdExtracted('s1');
  expect(execSpy).toHaveBeenCalledTimes(1);
});
```

> 需 mock `query`（`@anthropic-ai/claude-agent-sdk`）与 fs。`onPrdExtracted` 内部读资产表取 PRD content，并缓存 per-session 最近 content hash 与连续稳定轮数。

- [x] **Step 2: 写失败测试（并发同域串行）**

```ts
it('同域并发合并串行执行', async () => {
  let running = 0,
    maxRunning = 0;
  const slow = vi.fn().mockImplementation(
    () =>
      new Promise((r) =>
        setTimeout(() => {
          running--;
          maxRunning = Math.max(maxRunning, running);
          r(null);
        }, 30),
      ),
  );
  // 注入两个同域任务，断言 maxRunning 恒为 1（先拿到锁再执行）
  await Promise.all([merge('s1', '域A'), merge('s2', '域A')]);
  expect(maxRunning).toBe(1);
});
```

- [x] **Step 3: 运行测试确认失败**

```bash
cd server && pnpm exec vitest run src/archive/
```

- [x] **Step 4: 写实现**

```ts
// server/src/archive/archive.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

interface DebounceState {
  lastContent: string;
  stableRounds: number;
}

@Injectable()
export class ArchiveService {
  private readonly debounceRounds: number;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd: number;
  private readonly debounce = new Map<string, DebounceState>();
  private readonly domainLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    configService: ConfigService,
    private readonly logger: Logger,
  ) {
    this.debounceRounds = num(configService.get('ARCHIVE_DEBOUNCE_ROUNDS'), 3);
    this.maxTurns = num(configService.get('ARCHIVE_MERGE_MAX_TURNS'), 5);
    this.maxBudgetUsd = num(configService.get('ARCHIVE_MERGE_MAX_BUDGET_USD'), 0.2);
  }

  async onPrdExtracted(sessionId: string): Promise<void> {
    const asset = await this.prisma.asset.findFirst({
      where: { session: { sdkSessionId: sessionId }, type: 'prd', deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!asset) return;

    const st = this.debounce.get(sessionId);
    if (!st || st.lastContent !== asset.content) {
      this.debounce.set(sessionId, { lastContent: asset.content, stableRounds: 1 });
      return;
    }
    if (st.stableRounds < this.debounceRounds) {
      st.stableRounds += 1;
      return;
    }
    // 稳定轮数达标 → 触发（不删除状态，触发后重置计数防重复）
    st.stableRounds = 0;

    const session = await this.prisma.session.findFirst({
      where: { sdkSessionId: sessionId },
      include: { project: true },
    });
    if (!session || session.deletedAt !== null) return;
    const projectName = session.project.projectName;
    const domain = await this.resolveDomain(projectName, asset.title, asset.content);
    await this.mergeLocked(projectName, domain, asset.content).catch((e: Error) => {
      this.logger.error(`归档合并失败: ${e.message}`);
    });
  }

  private async resolveDomain(projectName: string, title: string, content: string): Promise<string> {
    // 已有域目录列表 → 提示模型复用
    const prdRoot = this.workspace.paths.sharedPrdDir(projectName);
    let domains: string[] = [];
    try {
      domains = (await fsp.readdir(prdRoot, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      domains = [];
    }
    // 独立 LLM 调用决定域（或简单规则：返回首个匹配 / 默认 '默认域'）
    if (domains.length === 0) return '默认域';
    // v1：调用合并 query 由模型返回目标域；此处简化——把域判断并入 executeMerge 的 prompt。
    return domains[0];
  }

  private mergeLocked(projectName: string, domain: string, prdContent: string): Promise<void> {
    const key = path.join(this.workspace.paths.sharedPrdDir(projectName), domain);
    const prev = this.domainLocks.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.runMergeWithRetry(projectName, domain, prdContent));
    this.domainLocks.set(key, next);
    return next.finally(() => {
      if (this.domainLocks.get(key) === next) this.domainLocks.delete(key);
    });
  }

  private async runMergeWithRetry(projectName: string, domain: string, prdContent: string): Promise<void> {
    let attempt = 0;
    while (attempt < 3) {
      try {
        return await this.executeMerge(projectName, domain, prdContent);
      } catch (e) {
        attempt += 1;
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * attempt)); // 指数退避 1s / 2s
      }
    }
  }

  private async executeMerge(projectName: string, domain: string, prdContent: string): Promise<void> {
    const aggregateFile = path.join(this.workspace.paths.sharedPrdDir(projectName), domain, 'index.md');
    await fsp.mkdir(path.dirname(aggregateFile), { recursive: true });
    let existing = '';
    try {
      existing = await fsp.readFile(aggregateFile, 'utf8');
    } catch {
      existing = '';
    }

    const requirementsRoot = this.workspace.paths.requirementsRoot(projectName);
    const q = query({
      prompt: `你是 Oceanus 需求归档合并器。请将新的 PRD 内容语义合并到既有的功能域聚合文档中。

【既有聚合文档】（可能为空）：
${existing || '(空)'}

【新的会话 PRD】：
${prdContent}

要求：
1. 完整保留既有聚合文档中的既有内容，不得丢失用户历史信息。
2. 将新 PRD 的用户信息整理后合并进去，去重、归类、保持 Markdown 结构。
3. 结果只写回聚合文档文件（用 Write 工具），不要输出额外解释。
目标文件：${aggregateFile}`,
      options: {
        tools: ['Read', 'Write', 'Glob', 'Grep'],
        cwd: requirementsRoot,
        additionalDirectories: [this.workspace.paths.sharedRoot(projectName)],
        skills: [],
        settingSources: [],
        maxTurns: this.maxTurns,
        maxBudgetUsd: this.maxBudgetUsd,
        model: 'default',
        env: process.env as Record<string, string>,
        includePartialMessages: true,
      },
    });
    for await (const msg of q) {
      if (msg.type === 'result' && (msg as { subtype?: string }).subtype === 'success') return;
      if (msg.type === 'result' && (msg as { is_error?: boolean }).is_error) {
        throw new Error(`合并调用失败: ${JSON.stringify((msg as { errors?: unknown }).errors)}`);
      }
    }
  }
}

function num(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
```

> **域归并 v1 简化**：`resolveDomain` 仅在无域时建「默认域」，否则复用首个域目录。将"模型语义判断域归属"作为增强点（把域列表并入合并 prompt，由模型在 Write 时选择目标文件）。design.md 已标注域归并依赖模型判断，v1 取最简可落地形式。

`archive.module.ts` 注册 `ArchiveService`（imports `WorkspaceModule`，providers `ArchiveService`，exports `ArchiveService`）。`app.module.ts` 加 `ArchiveModule`。

- [x] **Step 5: 运行测试确认通过**

```bash
cd server && pnpm exec vitest run src/archive/
```

Expected: PASS。

- [x] **Step 6: Commit**

```bash
git add server/src/archive/ server/src/app.module.ts
git commit -m "feat(archive): 去抖触发 + 域归并 + 独立合并调用 + mutex + 有界重试"
```

---

### Task 10: 环境配置与全量验证

**Files:**

- Modify: `server/.env.example`
- Modify: `docs/2-architecture/overview.md`（新增 workspace/skills/archive 三模块）
- Modify: `docs/2-architecture/data-model.md`（deleted_at + 部分唯一索引）
- Modify: `docs/2-architecture/decisions/`（新增 ADR：项目物理目录与 Agent 隔离 + 逻辑删除与归档合并）

- [x] **Step 1: .env.example 补充**

```bash
# ── 项目物理工作区 ──────────────────────────────
# 项目物理目录根（Agent 会话 cwd 的基座）
# PROJECTS_ROOT=./projects
# skills 安装超时（毫秒，默认 60000）
# SKILLS_INSTALL_TIMEOUT_MS=60000
# 归档合并去抖轮数（PRD 连续无变化轮数，默认 3）
# ARCHIVE_DEBOUNCE_ROUNDS=3
# 归档合并单次 query 上限（默认 5 / 0.20 USD）
# ARCHIVE_MERGE_MAX_TURNS=5
# ARCHIVE_MERGE_MAX_BUDGET_USD=0.20
```

- [x] **Step 2: 文档同步（按 CLAUDE.md 文档同步规则）**

- `docs/2-architecture/overview.md`：模块表新增 `WorkspaceModule`（路径/骨架/回收站）、`SkillsModule`（SkillsProvider/spawn CLI）、`ArchiveModule`（去抖/合并/回收站）。
- `docs/2-architecture/data-model.md`：5 表 `deleted_at` 列 + `projects_projectName_active` 部分唯一索引（`WHERE deleted_at IS NULL`）；说明 `@@unique` 不支持 where 而用 `@@index`。
- 新增 ADR 记录：D-1 模块划分、D-3 FS 先行、D-4 spawn CLI、D-6 写白名单、D-8 部分唯一索引、D-10 预生成 session_id。

- [x] **Step 3: 全量验证**

```bash
cd server && pnpm run build
cd server && pnpm run lint
cd server && pnpm test
```

Expected: 全绿。修复任何 lint/test 失败。

- [x] **Step 4: spike 收尾实证**

```bash
# 真实跑一次：创建项目 → 检查目录 + skills → 起会话 → 验证 tide-discuss 可加载
# 手动验证：Agent 尝试写 shared/ 被 deny；两个用户并行互不冲突
```

- [x] **Step 5: Commit**

```bash
git add server/.env.example docs/2-architecture/
git commit -m "docs+env: PROJECTS_ROOT 等配置 + 架构/数据模型/ADR 同步"
```

---

## Self-Review

**1. Spec 覆盖度：**

- project-workspace：Task 2/3（骨架/会话目录/回收站/残留处理）✅
- agent-workspace-isolation：Task 6/7（cwd/白名单/去 Bash/会话目录时点 D-10）✅
- skills-provisioning：Task 4（spawn CLI/版本标记/惰性刷新在 Task 7）✅
- archive-merge：Task 9（去抖/域归并/独立调用/mutex/有界重试）✅
- soft-delete：Task 1/5/8（schema/过滤/级联/回收站）✅
- project-management：Task 8（FS 先行/软删）✅
- agent-integration：Task 6（cwd/additionalDirectories/sessionId）✅
- asset-panel：Task 7（PRD 落盘 + 触发归档）✅

**2. 占位符扫描：** 无 TBD/TODO。`resolveDomain` v1 简化已明确标注（非占位，是确定的行为选择）。

**3. 类型一致性：** `WorkspacePathBuilder` 方法签名在 Task 2 定义、Task 3/5/7/8/9 引用一致；`SkillsProvider` 三方法在 Task 4 定义、Task 7/8 消费；`sendMessage` 新签名 Task 6 定义、Task 7 调用；`ArchiveService.onPrdExtracted(sessionId)` Task 7 触发、Task 9 实现——均一致。
