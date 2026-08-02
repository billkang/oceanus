import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DeepstormSkillsProvider } from './deepstorm-skills.provider';

const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

describe('DeepstormSkillsProvider', () => {
  let root: string;
  let provider: DeepstormSkillsProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-test-'));
    const config = { get: (k: string) => (k === 'SKILLS_INSTALL_TIMEOUT_MS' ? 10000 : undefined) } as ConfigService;
    provider = new DeepstormSkillsProvider(config, mockLogger);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('isOutdated 无标记文件返回 true', async () => {
    await expect(provider.isOutdated(root)).resolves.toBe(true);
  });

  it('install 复制 tide-* skills 到 .claude/skills，SKILL.md.tmpl 重命名为 SKILL.md', async () => {
    await provider.install(root);
    const skillsDir = join(root, '.claude', 'skills');
    const names = await readdir(skillsDir);
    expect(names).toContain('tide-discuss');
    expect(names).toContain('tide-publish');
    // .tmpl 应被重命名为 .md
    const discussFiles = await readdir(join(skillsDir, 'tide-discuss'));
    expect(discussFiles).toContain('SKILL.md');
    expect(discussFiles).not.toContain('SKILL.md.tmpl');
  });

  it('install 写入版本标记', async () => {
    await provider.install(root);
    const marker = JSON.parse(await readFile(join(root, '.claude', 'skills', '.deepstorm-skills.json'), 'utf8'));
    expect(marker.installedVersion).toEqual(expect.any(String));
  });

  it('install 超过 installTimeoutMs 即失败（超时强制执行，不再无限等待）', async () => {
    vi.useFakeTimers();
    try {
      const config = { get: (k: string) => (k === 'SKILLS_INSTALL_TIMEOUT_MS' ? 100 : undefined) } as ConfigService;
      const p = new DeepstormSkillsProvider(config, mockLogger);
      // doInstall 永不 resolve → 只能由超时收场
      vi.spyOn(p as unknown as { doInstall: (d: string) => Promise<void> }, 'doInstall').mockReturnValue(
        new Promise<void>(() => {}),
      );

      const result = p.install(root).catch((e: Error) => e);
      await vi.advanceTimersByTimeAsync(100);

      const err = await result;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('超时');
    } finally {
      vi.useRealTimers();
    }
  });

  it('版本一致 isOutdated 返回 false', async () => {
    await mkdir(join(root, '.claude', 'skills'), { recursive: true });
    const v = await provider.currentVersion();
    await writeFile(
      join(root, '.claude', 'skills', '.deepstorm-skills.json'),
      JSON.stringify({ installedVersion: v, installedAt: 'x' }),
    );
    await expect(provider.isOutdated(root)).resolves.toBe(false);
  });
});
