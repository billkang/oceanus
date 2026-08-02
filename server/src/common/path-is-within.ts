import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * 词法判断 child 是否位于 parent 目录内（含相等）。
 * 仅做路径字符串比较，不解析符号链接；需要防御 symlink 逃逸时配合 realpathDeepest 使用。
 */
export function isWithinLexical(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 解析路径中「最深已存在祖先」的符号链接，并把未解析的后缀路径段原样拼回。
 *
 * 用途：hook 写白名单判定时，先用 realpathDeepest 求目标真实路径，再用 isWithinLexical
 * 对照真实会话目录，可识别「词法在界内、realpath 后越界」的 symlink 逃逸路径。
 *
 * @throws 从参数路径一直回溯到文件系统根仍无任何存在的段时抛出
 */
export async function realpathDeepest(p: string): Promise<string> {
  const unresolved: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return path.join(real, ...unresolved.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`realpathDeepest: 无法解析任何存在的路径段: ${p}`);
      }
      unresolved.push(path.basename(current));
      current = parent;
    }
  }
}
