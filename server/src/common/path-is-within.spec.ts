import { describe, expect, it, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { isWithinLexical, realpathDeepest } from './path-is-within';

describe('isWithinLexical', () => {
  it('child 位于 parent 内（含相等）返回 true', () => {
    expect(isWithinLexical('/a', '/a')).toBe(true);
    expect(isWithinLexical('/a', '/a/b/c.txt')).toBe(true);
    expect(isWithinLexical('/a/b', '/a/b/c')).toBe(true);
  });

  it('child 位于 parent 外返回 false', () => {
    expect(isWithinLexical('/a', '/b')).toBe(false);
    // 前缀陷阱：/a/bc 并非 /a/b 的子路径
    expect(isWithinLexical('/a/b', '/a/bc')).toBe(false);
    // 越级逃逸
    expect(isWithinLexical('/a/b', '/a/b/../c')).toBe(false);
  });
});

describe('realpathDeepest', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  });

  it('路径全存在时返回真实路径（后缀保持原样）', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpd-'));
    const target = path.join(dir, 'target');
    await fsp.mkdir(target);

    const deep = path.join(target, 'sub', 'file.txt');

    expect(await realpathDeepest(deep)).toBe(path.join(await fsp.realpath(target), 'sub', 'file.txt'));
  });

  it('symlink 目录被解析为真实路径（词法判定看不到的逃逸）', async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rpd-'));
    const outside = path.join(dir, 'outside');
    await fsp.mkdir(outside);
    const link = path.join(dir, 'link');
    await fsp.symlink(outside, link, 'dir');

    const viaLink = path.join(link, 'secret.md');

    expect(await realpathDeepest(viaLink)).toBe(path.join(await fsp.realpath(outside), 'secret.md'));
  });
});
