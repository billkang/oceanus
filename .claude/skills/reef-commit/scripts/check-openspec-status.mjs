#!/usr/bin/env node

/**
 * check-openspec-status.mjs
 * 扫描 OpenSpec change 的状态。
 *
 * 用法:
 *   node check-openspec-status.mjs
 *   node check-openspec-status.mjs --branch add-auth
 *   node check-openspec-status.mjs --help
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TASKS_CHECKBOX_RE = /^- \[([ xX])\]/gm;

// ── Pure functions ────────────────────────────────────────────────

export function isArchived(changePath) {
  return changePath.includes('/archive/');
}

export function parseTasksStatus(content) {
  const matches = [...content.matchAll(TASKS_CHECKBOX_RE)];
  const total = matches.length;
  const complete = matches.filter(m => m[1] !== ' ').length;
  return {
    total,
    complete,
    allDone: total === 0 ? true : total === complete,
  };
}

export function scanChanges(changesDir) {
  if (!existsSync(changesDir)) return [];
  const entries = readdirSync(changesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name !== 'archive')
    .map(e => {
      const dirPath = join(changesDir, e.name);
      const tasksPath = join(dirPath, 'tasks.md');
      const hasTasksMd = existsSync(tasksPath);
      let tasksStatus = null;
      if (hasTasksMd) {
        tasksStatus = parseTasksStatus(
          readFileSync(tasksPath, 'utf8')
        );
      }
      return {
        name: e.name,
        archived: false,
        hasTasksMd,
        tasksAllDone: tasksStatus ? tasksStatus.allDone : null,
        tasksTotal: tasksStatus ? tasksStatus.total : 0,
        tasksComplete: tasksStatus ? tasksStatus.complete : 0,
      };
    });
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
check-openspec-status.mjs — 扫描 OpenSpec change 状态

用法:
  node check-openspec-status.mjs
  node check-openspec-status.mjs --branch <name>
  node check-openspec-status.mjs --help
`);
    process.exit(0);
  }

  const root = process.env.INIT_CWD || process.cwd();
  const changesDir = join(root, 'openspec', 'changes');
  const results = scanChanges(changesDir);

  const branchIdx = process.argv.indexOf('--branch');
  if (branchIdx >= 0) {
    const branch = process.argv[branchIdx + 1];
    const matched = results.filter(r =>
      r.name === branch || branch.includes(r.name)
    );
    process.stdout.write(JSON.stringify(
      matched.length > 0 ? matched : { noMatch: true, branch }, null, 2
    ) + '\n');
  } else {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  }
}
