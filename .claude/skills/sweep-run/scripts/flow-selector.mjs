#!/usr/bin/env node

/**
 * Sweep Flow Selector — 交互/非交互式选择工具
 *
 * 支持选择粒度：
 *   1. 模块级别（eg. user-system）
 *   2. 文件级别（eg. user-system/login.flow.md）
 *   3. 用例级别（eg. L01 - 正常登录）
 *
 * 读取 config（topology.yaml 或文件系统扫描），展示可勾选界面。
 * 当 TTY 不可用或使用 --text 标志时，自动回退到 readline 文本选择模式。
 * 将选中结果写入 .sweep-selection.json 并输出到 stdout。
 *
 * 使用方式：
 *   node scripts/flow-selector.mjs --list       # 非交互：列出可用文件（JSON）
 *   node scripts/flow-selector.mjs              # 自动检测 TTY（checkbox 或文本回退）
 *   node scripts/flow-selector.mjs --tui        # 强制 TUI checkbox 模式
 *   node scripts/flow-selector.mjs --text       # 强制文本输入模式
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';

// ── Lazy @inquirer/checkbox ─────────────────────────────────────────

let checkboxModule = null;

async function getCheckbox() {
  if (checkboxModule === undefined) {
    try {
      checkboxModule = (await import('@inquirer/checkbox')).default;
    } catch {
      checkboxModule = null;
    }
  }
  return checkboxModule;
}

// ── TTY detection ───────────────────────────────────────────────────

function isTtyAvailable() {
  return Boolean(
    process.stdout.isTTY &&
    process.stdin.isTTY &&
    process.stdin.setRawMode
  );
}

// ── YAML 解析（轻量，不依赖 yaml 包） ──────────────────────────

function parseTopology(yaml) {
  const modules = [];
  const lines = yaml.split('\n');
  let stack = [];

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    if (!trimmed.trim() || trimmed.trimStart().startsWith('#')) continue;

    const indent = trimmed.length - trimmed.trimStart().length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const lineTrimmed = trimmed.trimStart();
    const listMatch = lineTrimmed.match(/^-\s*name:\s*(.+)$/);
    if (!listMatch) continue;

    const name = listMatch[1];
    const parentList = stack.length > 0 ? stack[stack.length - 1].list : modules;
    const existing = parentList.find((m) => m.name === name);
    if (!existing) {
      parentList.push({ name, children: [] });
    }
    stack.push({ indent, list: parentList[parentList.length - 1].children });
  }

  return modules;
}

// ── Flow 文件解析 ────────────────────────────────────────────

function parseFlows(content) {
  const flows = [];
  const regex = /^## Flow:\s*(\S+)\s*-\s*(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    flows.push({ id: match[1], title: match[2].trim() });
  }
  return flows;
}

function resolveFlowFile(modulePath, baseFlowsDir) {
  const directPath = join(baseFlowsDir, `${modulePath}.flow.md`);
  if (existsSync(directPath)) return directPath;

  const parts = modulePath.split('/');
  const leafName = parts[parts.length - 1];
  const parentDir = parts.length > 1
    ? join(baseFlowsDir, parts.slice(0, -1).join('/'))
    : baseFlowsDir;
  if (existsSync(parentDir)) {
    const files = readdirSync(parentDir);
    const found = files.find(
      (f) => f.endsWith('.flow.md') && f.toLowerCase().includes(leafName.toLowerCase())
    );
    if (found) return join(parentDir, found);
  }

  const dirPath = join(baseFlowsDir, modulePath);
  if (existsSync(dirPath)) {
    const files = readdirSync(dirPath);
    const found = files.find((f) => f.endsWith('.flow.md'));
    if (found) return join(dirPath, found);
  }

  return null;
}

// ── 文件系统扫描 ────────────────────────────────────────────

function scanFlowFiles(dir) {
  const result = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      result.push(...scanFlowFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.flow.md')) {
      result.push(fullPath);
    }
  }

  return result;
}

// ── 非交互模式：构建文件列表 JSON ─────────────────────────

function buildFileList(baseFlowsDir) {
  const topologyPath = join(baseFlowsDir, 'topology.yaml');
  const files = [];

  if (existsSync(topologyPath)) {
    const yaml = readFileSync(topologyPath, 'utf-8');
    const modules = parseTopology(yaml);

    function walkModules(mods, prefix = '') {
      for (const mod of mods) {
        const path = prefix ? `${prefix}/${mod.name}` : mod.name;
        if (mod.children && mod.children.length > 0) {
          walkModules(mod.children, path);
        } else {
          const flowFile = resolveFlowFile(path, baseFlowsDir);
          if (flowFile) {
            const content = readFileSync(flowFile, 'utf-8');
            const flows = parseFlows(content);
            files.push({ file: flowFile, relative: path, flows });
          }
        }
      }
    }
    walkModules(modules);
  } else {
    const scanned = scanFlowFiles(baseFlowsDir);
    for (const file of scanned) {
      const content = readFileSync(file, 'utf-8');
      const flows = parseFlows(content);
      const rel = relative(baseFlowsDir, file);
      files.push({ file, relative: rel, flows });
    }
  }

  return { files, totalFiles: files.length, totalFlows: files.reduce((s, f) => s + f.flows.length, 0) };
}

// ── 构建 Choice 树 ──────────────────────────────────────────

function buildChoicesWithFlows(modules, baseFlowsDir, prefix = '') {
  const choices = [];

  for (const mod of modules) {
    const path = prefix ? `${prefix}/${mod.name}` : mod.name;

    if (mod.children && mod.children.length > 0) {
      choices.push(...buildChoicesWithFlows(mod.children, baseFlowsDir, path));
    } else {
      const flowFile = resolveFlowFile(path, baseFlowsDir);
      if (flowFile) {
        const content = readFileSync(flowFile, 'utf-8');
        const flows = parseFlows(content);

        choices.push({
          name: `📁 ${path}`,
          value: `__file:${flowFile}`,
          description: `${flows.length} 个用例`,
        });

        for (const f of flows) {
          choices.push({
            name: `  ${f.id} - ${f.title}`,
            value: JSON.stringify({ file: flowFile, flowId: f.id }),
            description: flowFile,
          });
        }
      } else {
        choices.push({
          name: `📁 ${path}`,
          value: `__module:${path}`,
          description: '未找到对应 .flow.md 文件',
        });
      }
    }
  }

  return choices;
}

function nameFromPath(p) {
  const parts = p.split('/');
  return parts[parts.length - 1];
}

// ── 处理选中结果 ────────────────────────────────────────────

function normalizeSelection(answer) {
  if (answer.includes('__all__')) {
    return { type: 'all' };
  }

  const fileMap = new Map();

  for (const item of answer) {
    if (item.startsWith('__file:')) {
      const filePath = item.slice('__file:'.length);
      if (!fileMap.has(filePath)) fileMap.set(filePath, []);
    } else if (item.startsWith('__module:')) {
      // ignore
    } else {
      try {
        const { file, flowId } = JSON.parse(item);
        if (!fileMap.has(file)) fileMap.set(file, []);
        const flows = fileMap.get(file);
        if (!flows.includes(flowId)) flows.push(flowId);
      } catch {
        // ignore
      }
    }
  }

  const files = [];
  for (const [filePath, selectedFlows] of fileMap) {
    const content = readFileSync(filePath, 'utf-8');
    const allFlows = parseFlows(content);
    const allIds = allFlows.map((f) => f.id);

    if (selectedFlows.length === 0 || selectedFlows.length >= allIds.length) {
      files.push({ file: filePath, flows: [], all: true });
    } else {
      files.push({ file: filePath, flows: selectedFlows, all: false });
    }
  }

  for (const item of answer) {
    if (item.startsWith('__file:')) {
      const filePath = item.slice('__file:'.length);
      const entry = files.find((f) => f.file === filePath);
      if (entry) entry.all = true;
    }
  }

  return { type: 'selection', files };
}

function writeSelection(data, selectionPath = '.sweep-selection.json') {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(selectionPath, json, 'utf-8');
  console.log(json);
}

// ── 文本选择模式 ────────────────────────────────────────────

/**
 * 将 choices 数组转换为扁平索引列表，供文本模式选择。
 * 只包含文件级条目（__file:），不展开到单个 flow 级别。
 * 返回 [{index, value, label, description}, ...]
 */
function buildFlatFileChoices(choices) {
  const flat = [];
  let idx = 0;

  for (const c of choices) {
    // Skip "全部执行" — it's handled separately
    if (c.value === '__all__') continue;
    // Only include file-level entries
    if (c.value.startsWith('__file:')) {
      idx++;
      flat.push({ index: idx, value: c.value, label: c.name.replace(/^📁\s*/, ''), description: c.description });
    }
  }

  return flat;
}

/**
 * 文本模式选择：使用 readline 接收用户输入。
 * 用户输入序号（逗号分隔）、范围（1-3）、或 all 来全选。
 */
async function askTextSelection(flatChoices) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Print options
    console.log('\n可用文件模块:');
    for (const f of flatChoices) {
      const label = f.label.padEnd(30);
      console.log(`  ${String(f.index).padStart(2)}. ${label} ${f.description}`);
    }
    console.log('  a. 全部执行\n');

    const answer = await new Promise((resolve) => {
      rl.question('输入序号选择（逗号分隔可多选，例如 1,3；范围 1-3；或 a 全选）: ', resolve);
    });

    const trimmed = answer.trim().toLowerCase();
    if (trimmed === 'a' || trimmed === 'all' || trimmed === '') {
      return ['__all__'];
    }

    // Parse comma-separated values and ranges
    const selected = new Set();
    const parts = trimmed.split(/[,，\s]+/).filter(Boolean);

    for (const part of parts) {
      const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        for (let i = start; i <= end; i++) {
          const match = flatChoices.find((f) => f.index === i);
          if (match) selected.add(match.value);
        }
      } else {
        const num = parseInt(part, 10);
        if (!isNaN(num)) {
          const match = flatChoices.find((f) => f.index === num);
          if (match) selected.add(match.value);
        }
      }
    }

    if (selected.size === 0) {
      console.log('未选择任何有效选项，将执行全部测试。');
      return ['__all__'];
    }

    return [...selected];
  } finally {
    rl.close();
  }
}

// ── 主流程 ──────────────────────────────────────────────────

async function main() {
  const BASE_FLOWS_DIR = join(process.cwd(), 'flows');
  const TOPOLOGY_PATH = join(BASE_FLOWS_DIR, 'topology.yaml');
  const SELECTION_PATH = join(process.cwd(), '.sweep-selection.json');

  const cliArgs = process.argv.slice(2);
  const forceText = cliArgs.includes('--text');
  const forceTui = cliArgs.includes('--tui');
  const listMode = cliArgs.includes('--list');

  // ── 非交互模式：直接输出可用文件列表 JSON ──────────────
  if (listMode) {
    if (!existsSync(BASE_FLOWS_DIR)) {
      console.error(JSON.stringify({ error: 'flows/ 目录不存在' }));
      process.exit(1);
    }
    const list = buildFileList(BASE_FLOWS_DIR);
    if (list.files.length === 0) {
      console.error(JSON.stringify({ error: '没有找到任何 .flow.md 文件' }));
      process.exit(1);
    }
    console.log(JSON.stringify(list, null, 2));
    return;
  }

  try {
    let modules = [];

    if (existsSync(TOPOLOGY_PATH)) {
      const yaml = readFileSync(TOPOLOGY_PATH, 'utf-8');
      modules = parseTopology(yaml);
    }

    if (!modules.length && !existsSync(BASE_FLOWS_DIR)) {
      console.error('⚠ flows/ 目录不存在');
      process.exit(1);
    }

    let choices;

    if (modules.length > 0) {
      choices = buildChoicesWithFlows(modules, BASE_FLOWS_DIR);
    } else {
      const files = scanFlowFiles(BASE_FLOWS_DIR);
      if (files.length === 0) {
        console.error('⚠ flows/ 目录下没有找到任何 .flow.md 文件');
        process.exit(1);
      }

      choices = [{ name: '📁 全部执行', value: '__all__' }];
      for (const file of files) {
        const rel = relative(BASE_FLOWS_DIR, file);
        const content = readFileSync(file, 'utf-8');
        const flows = parseFlows(content);
        choices.push({
          name: `📄 ${rel}`,
          value: `__file:${file}`,
          description: `${flows.length} 个用例`,
        });
        for (const f of flows) {
          choices.push({
            name: `  ${f.id} - ${f.title}`,
            value: JSON.stringify({ file, flowId: f.id }),
            description: rel,
          });
        }
      }
    }

    choices = [
      { name: '📋 全部执行', value: '__all__' },
      ...choices,
    ];

    // ── Decide mode: text vs checkbox ──────────────────────

    let answer;

    if (forceText) {
      // Force text mode
      const flat = buildFlatFileChoices(choices);
      answer = await askTextSelection(flat);
    } else if (forceTui) {
      // Force TUI checkbox mode
      const checkbox = await getCheckbox();
      if (!checkbox) {
        console.error('⚠ @inquirer/checkbox 不可用，回退到文本选择模式。');
        const flat = buildFlatFileChoices(choices);
        answer = await askTextSelection(flat);
      } else {
        answer = await checkbox({
          message: '选择要执行的测试用例（空格勾选，回车确认，a=全选）：',
          pageSize: 24,
          loop: false,
          choices,
          shortcuts: { all: 'a', invert: 'i' },
        });
      }
    } else {
      // Auto-detect: prefer checkbox if TTY is fully available
      const ttyOk = isTtyAvailable();
      if (ttyOk) {
        const checkbox = await getCheckbox();
        if (checkbox) {
          try {
            answer = await checkbox({
              message: '选择要执行的测试用例（空格勾选，回车确认，a=全选）：',
              pageSize: 24,
              loop: false,
              choices,
              shortcuts: { all: 'a', invert: 'i' },
            });
          } catch (checkboxErr) {
            // Checkbox failed at runtime — fall back to text mode
            if (checkboxErr.name === 'ExitPromptError') {
              process.exit(0);
            }
            console.error('\n⚠ 交互式选择器不可用，切换到文本选择模式。');
            const flat = buildFlatFileChoices(choices);
            answer = await askTextSelection(flat);
          }
        } else {
          const flat = buildFlatFileChoices(choices);
          answer = await askTextSelection(flat);
        }
      } else {
        const flat = buildFlatFileChoices(choices);
        answer = await askTextSelection(flat);
      }
    }

    const selection = normalizeSelection(answer);
    writeSelection(selection, SELECTION_PATH);
  } catch (e) {
    if (e.name === 'ExitPromptError') {
      process.exit(0);
    }
    // 出错时默认全量执行
    const fallback = { type: 'all' };
    writeSelection(fallback, SELECTION_PATH);
    process.exit(0);
  }
}

// ── Exports (for testing) ────────────────────────────────────

export {
  parseTopology,
  parseFlows,
  resolveFlowFile,
  scanFlowFiles,
  buildChoicesWithFlows,
  normalizeSelection,
  buildFlatFileChoices,
  buildFileList,
  askTextSelection,
  isTtyAvailable,
  getCheckbox,
};

// ── CLI entry point ──────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  main();
}
