vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { readdir } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ArchiveService } from './archive.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';

const mockLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const createMockConfig = () => ({ get: (_key: string) => undefined }) as unknown as ConfigService;

/** WorkspaceService mock：paths 提供 sharedPrdDir / requirementsRoot / sharedRoot */
const createMockWorkspace = () =>
  ({
    paths: {
      sharedPrdDir: vi.fn().mockReturnValue('/projects/proj/requirements/shared/prd'),
      requirementsRoot: vi.fn().mockReturnValue('/projects/proj/requirements'),
      sharedRoot: vi.fn().mockReturnValue('/projects/proj/requirements/shared'),
    },
  }) as unknown as WorkspaceService;

describe('ArchiveService', () => {
  let service: ArchiveService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      asset: { findFirst: vi.fn() },
      session: { findFirst: vi.fn() },
    } as unknown as PrismaService;
    service = new ArchiveService(prisma, createMockWorkspace(), createMockConfig(), mockLogger);
    vi.mocked(readdir).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('onPrdExtracted', () => {
    it('无 PRD 资产时静默返回', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue(null);

      await expect(service.onPrdExtracted('s1')).resolves.toBeUndefined();
      expect(prisma.session.findFirst).not.toHaveBeenCalled();
    });

    it('连续 3 轮无变化才触发合并；触发后计数重置', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue({ content: 'PRD-A' } as never);
      vi.mocked(prisma.session.findFirst).mockResolvedValue({ project: { projectName: 'proj' } } as never);
      const execSpy = vi
        .spyOn(service as unknown as { executeMerge: () => Promise<void> }, 'executeMerge')
        .mockResolvedValue();

      await service.onPrdExtracted('s1'); // 轮1
      await service.onPrdExtracted('s1'); // 轮2
      expect(execSpy).not.toHaveBeenCalled();

      await service.onPrdExtracted('s1'); // 轮3 → 触发
      expect(execSpy).toHaveBeenCalledTimes(1);

      // 触发后计数重置：再 3 轮才再次触发
      await service.onPrdExtracted('s1');
      await service.onPrdExtracted('s1');
      expect(execSpy).toHaveBeenCalledTimes(1);
    });

    it('内容变化重置稳定计数，不提前触发', async () => {
      vi.mocked(prisma.asset.findFirst)
        .mockResolvedValueOnce({ content: 'PRD-A' } as never)
        .mockResolvedValueOnce({ content: 'PRD-A' } as never)
        .mockResolvedValueOnce({ content: 'PRD-B' } as never)
        .mockResolvedValueOnce({ content: 'PRD-B' } as never)
        .mockResolvedValue({ content: 'PRD-B' } as never);
      vi.mocked(prisma.session.findFirst).mockResolvedValue({ project: { projectName: 'proj' } } as never);
      const execSpy = vi
        .spyOn(service as unknown as { executeMerge: () => Promise<void> }, 'executeMerge')
        .mockResolvedValue();

      await service.onPrdExtracted('s1'); // A stable=1
      await service.onPrdExtracted('s1'); // A stable=2
      await service.onPrdExtracted('s1'); // B 变化 → 重置 stable=1
      await service.onPrdExtracted('s1'); // B stable=2
      await service.onPrdExtracted('s1'); // B stable=3 → 触发
      expect(execSpy).toHaveBeenCalledTimes(1);
    });

    it('会话已软删时跳过合并', async () => {
      vi.mocked(prisma.asset.findFirst).mockResolvedValue({ content: 'PRD-A' } as never);
      vi.mocked(prisma.session.findFirst).mockResolvedValue(null);
      const execSpy = vi
        .spyOn(service as unknown as { executeMerge: () => Promise<void> }, 'executeMerge')
        .mockResolvedValue();

      await service.onPrdExtracted('s1');
      await service.onPrdExtracted('s1');
      await service.onPrdExtracted('s1'); // 达到触发轮数，但会话不存在 → 跳过
      expect(execSpy).not.toHaveBeenCalled();
    });
  });

  describe('mergeLocked（同域串行）', () => {
    it('同域并发合并串行执行（maxRunning 恒为 1）', async () => {
      let running = 0;
      let maxRunning = 0;
      const slow = vi.fn().mockImplementation(
        () =>
          new Promise<void>((r) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            setTimeout(() => {
              running -= 1;
              r(undefined);
            }, 30);
          }),
      );
      vi.spyOn(
        service as unknown as { runMergeWithRetry: () => Promise<void> },
        'runMergeWithRetry',
      ).mockImplementation(slow);

      await Promise.all([
        (service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }).mergeLocked(
          'proj',
          '域A',
          'PRD1',
        ),
        (service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }).mergeLocked(
          'proj',
          '域A',
          'PRD2',
        ),
      ]);

      expect(maxRunning).toBe(1);
      expect(slow).toHaveBeenCalledTimes(2);
    });

    it('前一次合并失败不阻塞后续同域合并（失败链传染修复）', async () => {
      const merge = vi
        .spyOn(
          service as unknown as { runMergeWithRetry: (p: string, d: string, c: string) => Promise<void> },
          'runMergeWithRetry',
        )
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      const first = (
        service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }
      ).mergeLocked('proj', '域A', 'PRD1');
      first.catch(() => undefined); // 先挂 no-op catch，避免 vitest 报 unhandled rejection
      const second = (
        service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }
      ).mergeLocked('proj', '域A', 'PRD2');

      await expect(first).rejects.toThrow('boom');
      // 链上某次失败后，后续排队任务仍应执行（prev 失败不得传染）
      await expect(second).resolves.toBeUndefined();
      expect(merge).toHaveBeenCalledTimes(2);
    });

    it('不同域可并行执行', async () => {
      let running = 0;
      let maxRunning = 0;
      const slow = vi.fn().mockImplementation(
        () =>
          new Promise<void>((r) => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            setTimeout(() => {
              running -= 1;
              r(undefined);
            }, 30);
          }),
      );
      vi.spyOn(
        service as unknown as { runMergeWithRetry: () => Promise<void> },
        'runMergeWithRetry',
      ).mockImplementation(slow);

      await Promise.all([
        (service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }).mergeLocked(
          'proj',
          '域A',
          'PRD1',
        ),
        (service as unknown as { mergeLocked: (p: string, d: string, c: string) => Promise<void> }).mergeLocked(
          'proj',
          '域B',
          'PRD2',
        ),
      ]);

      expect(maxRunning).toBe(2);
    });
  });

  describe('runMergeWithRetry（有界重试）', () => {
    it('executeMerge 失败重试 3 次后抛出', async () => {
      vi.useFakeTimers();
      const merge = vi
        .spyOn(service as unknown as { executeMerge: () => Promise<void> }, 'executeMerge')
        .mockRejectedValue(new Error('boom'));

      const p = (
        service as unknown as { runMergeWithRetry: (p: string, d: string, c: string) => Promise<void> }
      ).runMergeWithRetry('proj', '域A', 'PRD');
      // 计时器推进期间 p 已按预期 reject，但断言 handler 稍后才挂载；
      // 先挂 no-op catch 避免 vitest 报 unhandled rejection（断言行为不变）
      p.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(1000); // 第 1 次退避
      await vi.advanceTimersByTimeAsync(2000); // 第 2 次退避

      await expect(p).rejects.toThrow('boom');
      expect(merge).toHaveBeenCalledTimes(3);
    });

    it('第 2 次成功后不再重试', async () => {
      vi.useFakeTimers();
      const merge = vi
        .spyOn(service as unknown as { executeMerge: () => Promise<void> }, 'executeMerge')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined);

      const p = (
        service as unknown as { runMergeWithRetry: (p: string, d: string, c: string) => Promise<void> }
      ).runMergeWithRetry('proj', '域A', 'PRD');
      await vi.advanceTimersByTimeAsync(1000); // 第 1 次退避

      await expect(p).resolves.toBeUndefined();
      expect(merge).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeMerge（LLM 合并调用目录隔离）', () => {
    const success = () =>
      (async function* () {
        yield { type: 'result', subtype: 'success' };
      })();

    const call = () =>
      (service as unknown as { executeMerge: (p: string, d: string, c: string) => Promise<void> }).executeMerge(
        'proj',
        '域A',
        'PRD-A',
      );

    const getOptions = () => vi.mocked(query).mock.calls[0][0].options as Record<string, unknown>;

    it('cwd 限定共享 PRD 目录，env 注入独立 config dir，且带读写白名单 hooks', async () => {
      vi.mocked(query).mockReturnValue(success() as never);

      await call();

      expect(query).toHaveBeenCalledTimes(1);
      const options = getOptions();
      // cwd 不得暴露 private/（requirementsRoot），落在共享 PRD 区
      expect(options.cwd).toBe('/projects/proj/requirements/shared/prd');
      // config dir 独立（隔离宿主机全局配置）
      expect(options.env).toEqual(expect.objectContaining({ CLAUDE_CONFIG_DIR: expect.any(String) }));
      // 读写白名单 hooks 存在
      const preToolUse = (options.hooks as { PreToolUse: { matcher: string; hooks: unknown[] }[] }).PreToolUse;
      expect(preToolUse).toBeDefined();
      expect(preToolUse.find((h) => h.matcher === 'Write|Edit')).toBeDefined();
      expect(preToolUse.find((h) => h.matcher === 'Read')).toBeDefined();
    });

    it('写白名单拒绝越出共享 PRD 目录的路径（如 private/）', async () => {
      vi.mocked(query).mockReturnValue(success() as never);
      await call();

      const options = getOptions();
      const writeHook = (
        options.hooks as { PreToolUse: { matcher: string; hooks: ((i: unknown) => Promise<unknown>)[] }[] }
      ).PreToolUse.find((h) => h.matcher === 'Write|Edit');
      expect(writeHook).toBeDefined();

      const decision = await writeHook!.hooks[0]({
        hook_event_name: 'PreToolUse',
        tool_input: { file_path: '/projects/proj/requirements/private/secret.md' },
        cwd: '/projects/proj/requirements/shared/prd',
      });
      expect(decision).toEqual(
        expect.objectContaining({
          hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }),
        }),
      );
    });

    it('非 PreToolUse 事件（如 SessionStart）经守卫放行，不误伤会话生命周期 hook', async () => {
      vi.mocked(query).mockReturnValue(success() as never);
      await call();

      const options = getOptions();
      const writeHook = (
        options.hooks as { PreToolUse: { matcher: string; hooks: ((i: unknown) => Promise<unknown>)[] }[] }
      ).PreToolUse.find((h) => h.matcher === 'Write|Edit');
      expect(writeHook).toBeDefined();

      // matcher 仅绑定 PreToolUse，但 HookCallback 参数为 HookInput 联合；
      // 其他事件（如 SessionStart）必须原样放行，绝不产出 permissionDecision
      const decision = await writeHook!.hooks[0]({
        hook_event_name: 'SessionStart',
        session_id: 's1',
        transcript_path: '/tmp/t',
        cwd: '/projects/proj/requirements/shared/prd',
      });
      expect(decision).toEqual({ continue: true });
    });
  });
});
