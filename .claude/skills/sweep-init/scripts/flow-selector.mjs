#!/usr/bin/env node

/**
 * Sweep Flow Selector — 基于 @inquirer/checkbox 的层级选择工具
 *
 * 支持选择粒度：
 *   1. 模块级别（eg. user-system）
 *   2. 文件级别（eg. user-system/login.flow.md）
 *   3. 用例级别（eg. L01 - 正常登录）
 *
 * 读取 config（topology.yaml 或文件系统扫描），展示逐用例勾选界面。
 * 将选中结果写入 .sweep-selection.json 并输出到 stdout。
 *
 * 使用方式：node scripts/flow-selector.mjs
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const BASE_FLOWS_DIR = join(process.cwd(), 'flows');
const TOPOLOGY_PATH = join(BASE_FLOWS_DIR, 'topology.yaml');
const SELECTION_PATH = join(process.cwd(), '.sweep-selection.json');

/**
 * Override BASE_FLOWS_DIR for testing.
 * Only affects function calls that receive this parameter.
 */
export const DEFAULT_FLOWS_DIR = BASE_FLOWS_DIR;

// ── YAML 解析（轻量，不依赖 yaml 包） ──────────────────────────

export function parseTopology(yaml) {
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

/**
 * 解析 .flow.md 内容，提取所有 Flow 定义
 * @returns {Array<{id: string, title: string}>}
 */
export function parseFlows(content) {
  const flows = [];
  const regex = /^## Flow:\s*(\S+)\s*-\s*(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    flows.push({ id: match[1], title: match[2].trim() });
  }
  return flows;
}

/**
 * 根据模块名查找对应的 .flow.md 文件
 * 搜索策略：
 *   1. 直接匹配：flows/{module.path}.flow.md
 *   2. 父目录扫描：在父目录中找名称包含模块名的 .flow.md
 *   3. 子目录模式：flows/{module.path}/ 下的 .flow.md
 */
export function resolveFlowFile(modulePath, flowsDir = BASE_FLOWS_DIR) {
  const directPath = join(flowsDir, `${modulePath}.flow.md`);
  if (existsSync(directPath)) return directPath;

  const parts = modulePath.split('/');
  const leafName = parts[parts.length - 1];
  const parentDir = parts.length > 1
    ? join(flowsDir, parts.slice(0, -1).join('/'))
    : flowsDir;
  if (existsSync(parentDir)) {
    const files = readdirSync(parentDir);
    const found = files.find(
      (f) => f.endsWith('.flow.md') && f.toLowerCase().includes(leafName.toLowerCase())
    );
    if (found) return join(parentDir, found);
  }

  const dirPath = join(flowsDir, modulePath);
  if (existsSync(dirPath)) {
    const files = readdirSync(dirPath);
    const found = files.find((f) => f.endsWith('.flow.md'));
    if (found) return join(dirPath, found);
  }

  return null;
}

// ── 文件系统扫描 ────────────────────────────────────────────

export function scanFlowFiles(dir) {
  const result = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      result.push(...scanFlowFiles(fullPath));
    } else if (entry.name.endsWith('.flow.md')) {
      result.push(fullPath);
    }
  }
  return result;
}

// ── 构建 Choice 树 ──────────────────────────────────────────

export function buildChoicesWithFlows(modules, prefix = '', flowsDir = BASE_FLOWS_DIR) {
  const choices = [];

  for (const mod of modules) {
    const path = prefix ? `${prefix}/${mod.name}` : mod.name;

    if (mod.children && mod.children.length > 0) {
      choices.push(...buildChoicesWithFlows(mod.children, path, flowsDir));
    } else {
      const flowFile = resolveFlowFile(path, flowsDir);
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

// ── 处理选中结果 ────────────────────────────────────────────

export function normalizeSelection(answer) {
  if (answer.includes('__all__')) {
    return { type: 'all' };
  }

  const fileMap = new Map();

  for (const item of answer) {
    if (item.startsWith('__file:')) {
      const filePath = item.slice('__file:'.length);
      if (!fileMap.has(filePath)) fileMap.set(filePath, []);
    } else if (!item.startsWith('__module:')) {
      try {
        const { file, flowId } = JSON.parse(item);
        if (!fileMap.has(file)) fileMap.set(file, []);
        const flows = fileMap.get(file);
        if (!flows.includes(flowId)) flows.push(flowId);
      } catch { /* ignore */ }
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

export function writeSelection(data, selectionPath = SELECTION_PATH) {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(selectionPath, json, 'utf-8');
  console.log(json);
}

// ── CLI entry point ─────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  main().catch((e) => {
    if (e.name === 'ExitPromptError') process.exit(0);
    const fallback = { type: 'all' };
    writeSelection(fallback);
    process.exit(0);
  });
}

async function main() {
  try {
    let modules = [];
    let isFileScan = false;

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
      choices = buildChoicesWithFlows(modules);
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

    const { default: checkbox } = await import('@inquirer/checkbox');
    const answer = await checkbox({
      message: '选择要执行的测试用例（空格勾选，回车确认，a=全选）：',
      pageSize: 24,
      loop: false,
      choices,
      shortcuts: { all: 'a', invert: 'i' },
    });

    const selection = normalizeSelection(answer);
    writeSelection(selection);
  } catch (e) {
    if (e.name === 'ExitPromptError') {
      process.exit(0);
    }
    const fallback = { type: 'all' };
    writeSelection(fallback);
    process.exit(0);
  }
}
