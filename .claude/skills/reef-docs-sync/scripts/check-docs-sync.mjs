#!/usr/bin/env node

/**
 * check-docs-sync.mjs
 *
 * 文档同步检查 — 检测当前变更中需要同步文档的文件。
 *
 * 可同时作为模块导入（测试用）和 CLI 直接执行。
 *
 * 工作流：
 *   1. 读取 .deepstorm/settings.json → reef.docsSync 配置
 *   2. 通过 git diff 获取变更文件列表
 *   3. 将变更文件与映射规则匹配（用户自定义规则优先于默认规则）
 *   4. 输出格式化报告
 *
 * 映射规则示例：
 *   {
 *     "mappings": [
 *       { "pattern": "**\/*.controller.ts", "docs": ["3-api/README.md"] },
 *       { "pattern": "**\/*.service.ts", "docs": ["2-architecture/overview.md"] },
 *       { "pattern": "**\/schema.prisma", "docs": ["2-architecture/data-model.md"] }
 *     ]
 *   }
 *
 * 使用方式（外部调用）：
 *   node packages/reef/skills/reef-docs-sync/scripts/check-docs-sync.mjs
 *
 * 可指定工作目录：
 *   DOCS_SYNC_DIR=/path/to/project node check-docs-sync.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

// ── 默认映射规则（兜底） ──

export const DEFAULT_MAPPINGS = [
  { pattern: '**/*.controller.ts', docs: ['3-api/'] },
  { pattern: '**/*.service.ts', docs: ['2-architecture/overview.md'] },
  { pattern: '**/*.module.ts', docs: ['2-architecture/overview.md'] },
  { pattern: '**/schema.prisma', docs: ['2-architecture/data-model.md'] },
  { pattern: '**/*.component.ts', docs: ['4-ui/'] },
  { pattern: '**/*.component.html', docs: ['4-ui/'] },
  { pattern: '**/Dockerfile', docs: ['5-operations/deployment.md'] },
  { pattern: '**/docker-compose.yml', docs: ['5-operations/deployment.md'] },
  { pattern: '**/package.json', docs: ['1-getting-started/setup.md'] },
  { pattern: '**/README.md', docs: ['INDEX.md'] },
];

// ── 轻量 glob 匹配 ──

/**
 * 将 glob pattern 转为 RegExp。
 * 支持 *（单段通配）和 **（多段通配）。
 */
export function patternToRegex(pattern) {
  // 转义除了 * 以外的所有正则特殊字符
  let escaped = '';
  for (const ch of pattern) {
    if (
      ch === '*' ||
      ch === '?' ||
      ch === '[' ||
      ch === ']' ||
      ch === '{' ||
      ch === '}' ||
      ch === '(' ||
      ch === ')' ||
      ch === '^' ||
      ch === '$' ||
      ch === '.' ||
      ch === '+' ||
      ch === '|' ||
      ch === '\\'
    ) {
      // 通配符保留，其余转义
      if (ch === '*' || ch === '?') {
        escaped += ch;
      } else {
        escaped += '\\' + ch;
      }
    } else {
      escaped += ch;
    }
  }

  // ** → 匹配任意路径段
  // *  → 匹配除 / 外的任意字符
  // 但需要正确处理 **/ 和 /**
  let regexStr = '^';
  let i = 0;
  while (i < escaped.length) {
    if (escaped[i] === '*' && escaped[i + 1] === '*' && escaped[i + 2] === '/') {
      // **/ — 匹配零或多个路径段
      regexStr += '(.*/)?';
      i += 3;
    } else if (
      escaped[i] === '/' &&
      escaped[i + 1] === '*' &&
      escaped[i + 2] === '*' &&
      (i + 3 >= escaped.length || escaped[i + 3] === '\\')
    ) {
      // /** — 匹配零或多个路径段（pattern 结尾的 /**）
      regexStr += '(/.*)?';
      i += 3;
    } else if (escaped[i] === '/' && escaped[i + 1] === '*') {
      // /* — 匹配单段
      regexStr += '/[^/]*';
      i += 2;
    } else if (escaped[i] === '*') {
      // * — 匹配除 / 外的任意字符
      regexStr += '[^/]*';
      i += 1;
    } else if (escaped[i] === '?') {
      regexStr += '[^/]';
      i += 1;
    } else {
      regexStr += escaped[i];
      i += 1;
    }
  }
  regexStr += '$';

  try {
    return new RegExp(regexStr);
  } catch {
    // 无效 pattern → 不匹配任何文件
    return /(?!)/;
  }
}

/**
 * 检查文件路径是否匹配 glob pattern。
 */
export function matchGlob(filePath, pattern) {
  // 标准化路径分隔符
  const normalizedPath = filePath.replace(/\\/g, '/');
  const regex = patternToRegex(pattern);
  return regex.test(normalizedPath);
}

/**
 * 获取变更文件列表。
 * 同时检查 staged 和 unstaged 的变更。
 */
function getChangedFiles(projectDir) {
  try {
    // staged 变更
    const staged = execSync('git diff --name-status --cached', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // unstaged 变更
    const unstaged = execSync('git diff --name-status', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // untracked 文件
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const files = [];

    for (const line of (staged + '\n' + unstaged).split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const status = parts[0];
        const filePath = parts[parts.length - 1];
        const displayStatus = { A: '新增', M: '修改', D: '删除', R: '重命名', C: '复制' }[status[0]] || status;
        files.push({ filePath, status: displayStatus });
      }
    }

    for (const filePath of untracked.split('\n').filter(Boolean)) {
      files.push({ filePath, status: '新增（未跟踪）' });
    }

    return files;
  } catch {
    // git 命令失败（不在 git 仓库、无变更）
    return [];
  }
}

/**
 * 读取项目的 .deepstorm/settings.json，获取 docs-sync 配置。
 */
function readDocsSyncConfig(projectDir) {
  const settingsPath = resolve(projectDir, '.deepstorm', 'settings.json');
  if (!existsSync(settingsPath)) return null;

  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    const config = JSON.parse(raw);
    return config?.reef?.docsSync || null;
  } catch {
    return null;
  }
}

/**
 * 核心匹配逻辑。
 * 优先级：用户自定义 mappings → 默认 mappings。
 */
export function matchFilesToDocs(changedFiles, mappings, defaultMappings) {
  const allMappings = [...(mappings || []), ...(defaultMappings || [])];
  const matchedDocs = new Set();

  for (const file of changedFiles) {
    for (const rule of allMappings) {
      if (matchGlob(file.filePath, rule.pattern)) {
        for (const doc of rule.docs) {
          matchedDocs.add(JSON.stringify({ file: file.filePath, status: file.status, doc }));
        }
      }
    }
  }

  return Array.from(matchedDocs).map((s) => JSON.parse(s));
}

/**
 * 格式化输出报告。
 */
export function formatReport(results) {
  if (results.length === 0) return null;

  const lines = [];

  // 按文档路径分组
  const byDoc = {};
  for (const r of results) {
    if (!byDoc[r.doc]) byDoc[r.doc] = [];
    byDoc[r.doc].push(r);
  }

  lines.push('## 📖 文档同步检查');
  lines.push('');
  lines.push('以下变更文件需要同步更新对应的文档：');
  lines.push('');

  for (const [doc, entries] of Object.entries(byDoc)) {
    lines.push(`### ${doc}`);
    lines.push('');
    for (const e of entries) {
      lines.push(`- [${e.status}] \`${e.file}\``);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('运行 \`/docs-sync\` 查看详情并自动起草更新内容。');
  lines.push('');

  return lines.join('\n');
}

// ── 主入口 ──

function main() {
  const projectDir = process.env.DOCS_SYNC_DIR || process.cwd();

  // 1. 获取变更文件
  const changedFiles = getChangedFiles(projectDir);
  if (changedFiles.length === 0) return;

  // 2. 读取配置
  const config = readDocsSyncConfig(projectDir);
  const userMappings = config?.mappings;

  // 3. 匹配
  const results = matchFilesToDocs(changedFiles, userMappings, DEFAULT_MAPPINGS);
  if (results.length === 0) return;

  // 4. 输出报告
  const report = formatReport(results);
  if (report) {
    console.log(report);
  }
}

main();
