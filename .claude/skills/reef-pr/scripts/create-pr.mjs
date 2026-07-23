#!/usr/bin/env node

/**
 * create-pr.mjs — PR 上下文收集与创建
 *
 * 用法:
 *   node create-pr.mjs --collect          # 收集 PR 上下文
 *   node create-pr.mjs --create <args>    # 创建 PR
 *   node create-pr.mjs --help
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Pure functions ────────────────────────────────────────────────

export function checkUncommitted(statusShort) {
  return statusShort.trim().length > 0;
}

export function buildPrBody(ctx) {
  const lines = [];

  lines.push('## 概要');
  if (ctx.proposalTitle) {
    lines.push(ctx.proposalTitle);
  } else if (ctx.commitLog && ctx.commitLog.length > 0) {
    lines.push(ctx.commitLog[0].message);
  } else {
    lines.push(ctx.branch);
  }

  lines.push('');
  lines.push('## 关联');
  lines.push(`Branch: ${ctx.branch}`);

  if (ctx.diffStat) {
    const s = ctx.diffStat;
    lines.push(`Changes: ${s.files} 文件, +${s.insertions}/-${s.deletions}`);
    lines.push('');
    lines.push('## 变更清单');
    s.changedFiles.forEach(f => lines.push(`- \`${f}\``));
  }

  if (ctx.commitLog && ctx.commitLog.length > 0) {
    lines.push('');
    lines.push('## Commits');
    ctx.commitLog.forEach(c => lines.push(`- ${c.hash} ${c.message}`));
  }

  return lines.join('\n');
}

export function buildGhCreateArgs(opts) {
  const args = ['gh pr create'];
  args.push(`--title "${opts.title}"`);
  args.push(`--body "${opts.body}"`);
  if (opts.reviewer) args.push(`--reviewer ${opts.reviewer}`);
  if (opts.label) args.push(`--label ${opts.label}`);
  if (opts.draft) args.push('--draft');
  return args.join(' ');
}

// ── Git helpers ────────────────────────────────────────────────────

function exec(command) {
  try {
    return execSync(command, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function collectContext() {
  const branch = exec('git branch --show-current');
  const forkPoint = exec(
    'git merge-base main HEAD 2>/dev/null || echo ""'
  );
  const diffStat = exec(
    `git diff "${forkPoint || 'main'}..HEAD" --stat`
  );
  const commitLog = forkPoint
    ? exec(`git log "${forkPoint}"..HEAD --oneline`)
    : '';
  const statusShort = exec('git status --short');

  // 查找关联 proposal
  let proposalTitle = '';
  const root = exec(
    'git rev-parse --show-toplevel 2>/dev/null || echo ""'
  );
  if (root && branch) {
    const p = join(root, 'openspec', 'changes', branch, 'proposal.md');
    if (existsSync(p)) {
      const firstLine = readFileSync(p, 'utf8')
        .split('\n')[0] || '';
      proposalTitle = firstLine.replace(/^#+\s*/, '').trim();
    }
  }

  return {
    branch,
    hasUncommitted: checkUncommitted(statusShort),
    proposalTitle,
    commitLog: commitLog
      ? commitLog.split('\n').filter(Boolean).map(l => {
          const m = l.match(/^(\S+)\s+(.*)/);
          return m ? { hash: m[1], message: m[2] } : null;
        }).filter(Boolean)
      : [],
    diffStat: diffStat ? parseDiffStat(diffStat) : null,
  };
}

function parseDiffStat(output) {
  const lines = output.trim().split('\n').filter(Boolean);
  const changedFiles = [];
  let files = 0, insertions = 0, deletions = 0;

  for (const line of lines) {
    const sm = line.match(/(\d+)\s+files?\s+changed/);
    if (sm) {
      files = parseInt(sm[1], 10);
      const im = line.match(/(\d+)\s+insertions?\(\+\)/);
      if (im) insertions = parseInt(im[1], 10);
      const dm = line.match(/(\d+)\s+deletions?\(-\)/);
      if (dm) deletions = parseInt(dm[1], 10);
      continue;
    }
    const fm = line.match(/^\s*(.+?)\s+\|/);
    if (fm) changedFiles.push(fm[1].trim());
  }

  return { files, insertions, deletions, changedFiles };
}

function checkExistingPR() {
  const out = exec('gh pr view --json url 2>/dev/null || true');
  return out ? { exists: true, url: out } : { exists: false };
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
create-pr.mjs — PR 上下文收集与创建

用法:
  node create-pr.mjs --collect            收集 PR 上下文（JSON）
  node create-pr.mjs --create             创建 PR
  node create-pr.mjs --help               显示帮助

--create 选项:
  --title <text>     PR 标题
  --body <text>      PR 正文
  --reviewer <user>  Reviewer
  --label <label>    标签
  --draft            创建 Draft PR
`);
    process.exit(0);
  }

  if (process.argv.includes('--collect')) {
    const ctx = collectContext();
    process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
    process.exit(0);
  }

  if (process.argv.includes('--create')) {
    const titleArg = process.argv.indexOf('--title');
    const bodyArg = process.argv.indexOf('--body');
    const reviewerArg = process.argv.indexOf('--reviewer');
    const labelArg = process.argv.indexOf('--label');
    const isDraft = process.argv.includes('--draft');

    if (titleArg < 0 || bodyArg < 0) {
      console.error('--title 和 --body 必填');
      process.exit(1);
    }

    const existing = checkExistingPR();
    if (existing.exists) {
      process.stdout.write(JSON.stringify(existing, null, 2) + '\n');
      process.exit(0);
    }

    const branch = exec('git branch --show-current');
    const pushOut = exec(`git push -u origin ${branch} 2>&1`);
    if (!pushOut) {
      console.error('git push 失败');
      process.exit(1);
    }

    const cmd = buildGhCreateArgs({
      title: process.argv[titleArg + 1],
      body: process.argv[bodyArg + 1],
      branch,
      reviewer: reviewerArg >= 0
        ? process.argv[reviewerArg + 1] : null,
      label: labelArg >= 0 ? process.argv[labelArg + 1] : null,
      draft: isDraft,
    });

    const out = exec(cmd);
    process.stdout.write(JSON.stringify({
      created: true,
      url: out,
    }, null, 2) + '\n');
    process.exit(0);
  }

  // 默认：--collect
  const ctx = collectContext();
  process.stdout.write(JSON.stringify(ctx, null, 2) + '\n');
}
