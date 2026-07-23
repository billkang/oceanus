#!/usr/bin/env node

/**
 * find-change-dir.mjs
 * 自动发现当前 OpenSpec change 目录。
 *
 * 用法:
 *   node find-change-dir.mjs                   # 根据分支自动查找
 *   node find-change-dir.mjs --branch <name>   # 指定分支
 *   node find-change-dir.mjs --files           # 同时列出 SDD 文档
 *   node find-change-dir.mjs --dir <path>      # 指定扫描目录
 *   node find-change-dir.mjs --help
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const CHANGES_GLOB = 'openspec/changes';

// ── Pure functions ────────────────────────────────────────────────

function isArchivePath(changePath) {
  return changePath.includes('/archive/');
}

/**
 * 在 changes 列表中按 name 精确查找
 * @param {Array} changes
 * @param {string} name
 * @returns {object|null}
 */
export function findChangeByName(changes, name) {
  return changes.find(c =>
    c.name === name && !isArchivePath(c.path)
  ) || null;
}

/**
 * 返回最近修改的非归档 change
 * @param {Array} changes
 * @returns {object|null}
 */
export function findMostRecent(changes) {
  const active = changes.filter(c => !c.archived);
  if (active.length === 0) return null;
  return active.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

/**
 * 列出 changes 目录下的所有 change
 * @param {string} changesDir
 * @returns {Array<{name:string, path:string, archived:boolean, mtimeMs:number, files:string[]}>}
 */
export function listChanges(changesDir) {
  if (!existsSync(changesDir)) return [];
  const entries = readdirSync(changesDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'archive') continue;

    const dirPath = join(changesDir, entry.name);
    const stats = statSync(dirPath);

    // 收集 .md 文件
    const files = collectMdFiles(dirPath);

    results.push({
      name: entry.name,
      path: dirPath,
      archived: false,
      mtimeMs: stats.mtimeMs,
      files,
    });
  }

  return results;
}

function collectMdFiles(dir) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) {
        files.push(join(dir, e.name));
      }
      if (e.isDirectory()) {
        const sub = collectMdFiles(join(dir, e.name));
        files.push(...sub);
      }
    }
    return files;
  } catch {
    return [];
  }
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
find-change-dir.mjs — 发现 OpenSpec change 目录

用法:
  node find-change-dir.mjs                 根据分支自动查找
  node find-change-dir.mjs --branch <name> 指定分支
  node find-change-dir.mjs --files         同时列出 SDD 文档
  node find-change-dir.mjs --dir <path>    指定扫描目录
  node find-change-dir.mjs --help
`);
    process.exit(0);
  }

  const root = process.argv.indexOf('--dir') >= 0
    ? process.argv[process.argv.indexOf('--dir') + 1]
    : process.env.INIT_CWD || process.cwd();
  const changesDir = join(root, CHANGES_GLOB);
  const allChanges = listChanges(changesDir);

  const branchIdx = process.argv.indexOf('--branch');
  let result;

  if (branchIdx >= 0) {
    const branch = process.argv[branchIdx + 1];
    result = findChangeByName(allChanges, branch);
    if (!result) {
      result = {
        noMatch: true,
        branch,
        suggestion: findMostRecent(allChanges),
      };
    }
  } else {
    const branch = execGitBranch();
    result = branch
      ? (findChangeByName(allChanges, branch) ||
         { noMatch: true, branch,
           suggestion: findMostRecent(allChanges) })
      : { noMatch: true, allChanges };
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function execGitBranch() {
  try {
    return execSync('git branch --show-current', {
      encoding: 'utf8', timeout: 5000,
    }).trim() || null;
  } catch {
    return null;
  }
}
