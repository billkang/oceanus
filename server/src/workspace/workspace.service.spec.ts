import { mkdtemp, rm, stat, readlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let root: string;
  let service: WorkspaceService;

  const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-test-'));
    const config = { get: (k: string) => (k === 'PROJECTS_ROOT' ? root : undefined) } as ConfigService;
    service = new WorkspaceService(config, mockLogger);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

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

  it('ensureFreshProjectDir 处理残留目录（rename 到回收站）', async () => {
    await service.createSkeleton('proj');
    await service.ensureFreshProjectDir('proj');
    // 原目录已移走
    await expect(stat(join(root, 'proj'))).rejects.toThrow();
  });
});
