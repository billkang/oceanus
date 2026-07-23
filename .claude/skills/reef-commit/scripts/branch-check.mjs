#!/usr/bin/env node

/**
 * branch-check.mjs
 * 检查当前分支是否合法。
 *
 * 用法:
 *   node branch-check.mjs
 *   node branch-check.mjs --branch feat/add-auth
 *   node branch-check.mjs --help
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Exported constants (for test access) ──────────────────────────

/** 临时分支名正则 */
export const TEMP_PATTERN = /^(temp|wip|test|tmp|dev)(\/.*)?$/;

// ── Pure functions ────────────────────────────────────────────────

export function isMainOrMaster(branch) {
  return branch === 'main' || branch === 'master';
}

/**
 * 检查分支是否合法。
 * @param {string} branch
 * @param {Array<{name:string}>} openspecTasks
 * @returns {{isValid:boolean, reason?:string, action:string,
 *           warning:boolean, matchedTask?:string}}
 */
export function checkBranch(branch, openspecTasks = []) {
  if (isMainOrMaster(branch)) {
    return {
      isValid: false,
      reason: `不允许在 ${branch} 分支上直接提交`,
      action: 'create-branch',
      warning: false,
    };
  }

  const isTemp = TEMP_PATTERN.test(branch);
  const action = isTemp ? 'suggest-rename' : 'continue';
  const matchedTask = openspecTasks.find(t =>
    branch === t.name || branch.includes(t.name)
  );

  return {
    isValid: true,
    warning: isTemp,
    action,
    ...(isTemp ? { reason: '分支名像临时分支，建议改名' } : {}),
    ...(matchedTask ? { matchedTask: matchedTask.name } : {}),
  };
}

// ── Shell helpers ─────────────────────────────────────────────────

function exec(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

function findOpenspecTasks() {
  const root = exec(
    'git rev-parse --show-toplevel 2>/dev/null || echo ""'
  );
  if (!root) return [];
  const changesDir = join(root, 'openspec', 'changes');
  if (!existsSync(changesDir)) return [];

  const entries = readdirSync(changesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name !== 'archive')
    .map(e => ({
      name: e.name,
      hasProposal: existsSync(join(changesDir, e.name, 'proposal.md')),
    }));
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
branch-check.mjs — 检查分支合法性

用法:
  node branch-check.mjs                      自动检测
  node branch-check.mjs --branch <name>      指定分支
  node branch-check.mjs --help               显示帮助
`);
    process.exit(0);
  }

  const idx = process.argv.indexOf('--branch');
  const branch = idx >= 0
    ? process.argv[idx + 1]
    : exec('git branch --show-current');
  const tasks = findOpenspecTasks();
  const result = checkBranch(branch, tasks);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
