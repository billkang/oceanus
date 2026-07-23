#!/usr/bin/env node

/**
 * collect-git-context.mjs
 * 收集 git 上下文，输出结构化 JSON。
 *
 * 用法:
 *   node collect-git-context.mjs              # 输出 JSON
 *   node collect-git-context.mjs --help       # 查看帮助
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Pure parse functions (testable) ──────────────────────────────────

/**
 * 解析 `git diff --stat` 输出
 * @param {string} output
 * @returns {{ files: number, insertions: number, deletions: number, changedFiles: string[] }}
 */
export function parseDiffStat(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  const changedFiles = [];
  let files = 0, insertions = 0, deletions = 0;

  for (const line of lines) {
    // 匹配汇总行: "2 files changed, 13 insertions(+), 2 deletions(-)"
    const summaryMatch = line.match(/(\d+)\s+files?\s+changed/);
    if (summaryMatch) {
      files = parseInt(summaryMatch[1], 10);
      const insMatch = line.match(/(\d+)\s+insertions?\(\+\)/);
      if (insMatch) insertions = parseInt(insMatch[1], 10);
      const delMatch = line.match(/(\d+)\s+deletions?\(-\)/);
      if (delMatch) deletions = parseInt(delMatch[1], 10);
      continue;
    }
    // 匹配文件行: "src/main.ts | 10 ++++++++--"
    const fileMatch = line.match(/^\s*(.+?)\s+\|/);
    if (fileMatch) {
      changedFiles.push(fileMatch[1].trim());
    }
  }

  return { files, insertions, deletions, changedFiles };
}

/**
 * 解析 `git log --oneline` 输出
 * @param {string} output
 * @returns {Array<{ hash: string, message: string }>}
 */
export function parseCommitLog(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  return lines.map(line => {
    const match = line.match(/^(\S+)\s+(.*)/);
    return match ? { hash: match[1], message: match[2] } : null;
  }).filter(Boolean);
}

/**
 * 从分支名或 commit 信息中提取 JIRA 引用编号
 * @param {string} branchName
 * @param {Array<{hash:string,message:string}>} [commitLog]
 * @returns {string|null}
 */
export function extractJiraRef(branchName, commitLog) {
  const JIRA_RE = /[A-Z]{2,}-\d+/;
  const branchMatch = branchName.match(JIRA_RE);
  if (branchMatch) return branchMatch[0];
  if (commitLog) {
    for (const commit of commitLog) {
      const match = commit.message.match(JIRA_RE);
      if (match) return match[0];
    }
  }
  return null;
}

// ── Shell exec helpers ──────────────────────────────────────────────

function exec(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

// ── Context collection ──────────────────────────────────────────────

/**
 * 收集完整的 git 上下文
 * @returns {{ branch: string, forkPoint: string|null, diffStat: object|null, commitLog: Array, hasUncommitted: boolean, openspecChanges: Array|null }}
 */
export function collectContext() {
  const branch = exec('git branch --show-current');
  let forkPoint;
  let error;
  try {
    forkPoint = execSync('git merge-base main HEAD', { encoding: 'utf8' }).trim();
  } catch {
    error = '无法找到基准点';
  }
  const diffStat = exec(`git diff "${forkPoint || 'main'}..HEAD" --stat`);
  const commitLogRaw = forkPoint
    ? exec(`git log "${forkPoint}"..HEAD --oneline`)
    : '';
  const statusShort = exec('git status --short');
  const hasUncommitted = statusShort.length > 0;

  // OpenSpec change 扫描
  let openspecChanges = null;
  const root = exec('git rev-parse --show-toplevel 2>/dev/null || echo ""');
  if (root) {
    const changesDir = join(root, 'openspec', 'changes');
    if (existsSync(changesDir)) {
      try {
        const entries = readdirSync(changesDir, { withFileTypes: true });
        const changeDirs = entries
          .filter(e => e.isDirectory() && e.name !== 'archive')
          .map(e => {
            const proposalPath = join(changesDir, e.name, 'proposal.md');
            const hasProposal = existsSync(proposalPath);
            let title = e.name;
            if (hasProposal) {
              const firstLine = readFileSync(proposalPath, 'utf8').split('\n')[0] || '';
              title = firstLine.replace(/^#\s*/, '').trim() || e.name;
            }
            return {
              name: e.name,
              hasProposal,
              matched: branch === e.name,
              title,
            };
          });
        if (changeDirs.length > 0) openspecChanges = changeDirs;
      } catch {
        // ignore
      }
    }
  }

  const parsedCommitLog = commitLogRaw ? parseCommitLog(commitLogRaw) : [];

  return {
    branch,
    forkPoint: forkPoint || null,
    diffStat: diffStat ? parseDiffStat(diffStat) : null,
    commitLog: parsedCommitLog,
    hasUncommitted,
    openspecChanges,
    jiraRef: extractJiraRef(branch, parsedCommitLog),
    ...(error ? { error } : {}),
  };
}

// ── CLI entry ───────────────────────────────────────────────────────

function printHelp() {
  console.log(`
collect-git-context.mjs — 收集 git 上下文

用法:
  node collect-git-context.mjs         输出 JSON 格式的 git 上下文
  node collect-git-context.mjs --help  显示本帮助

输出字段:
  branch          当前分支名
  forkPoint       main 的 merge-base
  diffStat        { files, insertions, deletions, changedFiles }
  commitLog       [{ hash, message }]
  hasUncommitted  是否有未提交变更
  openspecChanges [{ name, hasProposal, matched, title }] 或 null
`);
}

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  const context = collectContext();
  process.stdout.write(JSON.stringify(context, null, 2) + '\n');
}
