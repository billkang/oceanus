#!/usr/bin/env node

/**
 * Spec Compiler — 从 flow-parser 的解析结果生成 Playwright .spec.ts
 *
 * Usage:
 *   node spec-compiler.mjs <path-to-flow.md>        # CLI: parse + compile, write .flow.spec.ts
 *   import { compile } from './spec-compiler.mjs'     # API: compile from parsed result
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse } from './flow-parser.mjs';

// ── Operation to Playwright API mapping ───────────────────────────

/**
 * Infer a Playwright action from a step description.
 * Returns { comment, action, args }.
 */
function inferAction(description, index) {
  const desc = description.trim();

  // Navigation
  if (/导航|打开|goto/i.test(desc)) {
    const urlMatch = desc.match(/`([^`]+)`/);
    const url = urlMatch ? urlMatch[1] : 'process.env.BASE_URL || \'/\'';
    return {
      comment: desc,
      action: 'page.goto',
      args: [url],
    };
  }

  // Click
  if (/点击|单击|按下|click/i.test(desc)) {
    const targetMatch = desc.match(/[""「」](.+?)[""」』]/);
    const selector = targetMatch ? `text="${targetMatch[1]}"` : inferSelector(desc);
    return {
      comment: desc,
      action: 'page.click',
      args: [selector],
    };
  }

  // Fill / type
  if (/输入|键入|填写|fill|type/i.test(desc)) {
    const valueMatch = desc.match(/`([^`]+)`/);
    const value = valueMatch ? valueMatch[1] : '';
    const targetMatch = desc.match(/[""「」](.+?)[""」』]/);
    const selector = targetMatch ? `[placeholder="${targetMatch[1]}" i]` : `input${index > 0 ? `:nth-child(${index})` : ''}`;
    return {
      comment: desc,
      action: 'page.fill',
      args: [selector, value],
    };
  }

  // Select
  if (/选择|select|选中/i.test(desc)) {
    return {
      comment: desc,
      action: 'page.selectOption',
      args: ['select', ''],
    };
  }

  // Wait
  if (/等待|wait|暂停/i.test(desc)) {
    return {
      comment: desc,
      action: 'page.waitForTimeout',
      args: [1000],
    };
  }

  // Default: log as unsupported comment
  return {
    comment: desc,
    action: null,
    args: [],
  };
}

/**
 * Infer a CSS selector from a description.
 * Heuristic: extract quoted text or noun phrases.
 */
function inferSelector(desc) {
  // Try to match quoted text first
  const quoted = desc.match(/[""「」『』](.+?)[""」』『']/);
  if (quoted) return `text="${quoted[1]}"`;

  // Try to match role-like phrases
  if (/按钮/.test(desc)) return 'button';
  if (/链接/.test(desc)) return 'a';
  if (/输入框|输入|文本框/.test(desc)) return 'input';
  if (/菜单|下拉/.test(desc)) return 'select';
  if (/复选框|checkbox/.test(desc)) return '[type="checkbox"]';

  return 'body';
}

// ── Validation to Playwright assertion mapping ────────────────────

function inferAssertion(validation) {
  const v = validation.trim();

  if (/标题/.test(v) && /包含|包含/.test(v)) {
    const title = v.match(/[""「」](.+?)[""」』]/);
    const expected = title ? title[1] : '';
    return { assertion: 'toHaveTitle', args: [expected || /.*/], raw: v };
  }

  if (/URL|url|跳转|跳转到|路径/.test(v)) {
    const url = v.match(/`([^`]+)`/);
    const expected = url ? url[1] : '';
    return { assertion: 'toHaveURL', args: [expected || /.*/], raw: v };
  }

  if (/可见|显示|出现|元素/.test(v)) {
    const target = v.match(/[""「」](.+?)[""」』]/);
    const selector = target ? `text="${target[1]}"` : inferSelector(v);
    return { assertion: 'toBeVisible', args: [selector], raw: v };
  }

  if (/文本|内容|文字|包含|值为/.test(v)) {
    const text = v.match(/[""「」『』](.+?)[""」』『']/);
    const expected = text ? text[1] : '';
    const selector = inferSelector(v);
    return { assertion: 'toHaveText', args: [selector, expected], raw: v };
  }

  if (/不跳转|不跳|相同|不变/.test(v)) {
    return { assertion: 'toHaveURL', args: [/.*/], raw: v };
  }

  // Default: generic visibility check
  const selector = inferSelector(v);
  return { assertion: 'toBeVisible', args: [selector], raw: v };
}

// ── Code generation ───────────────────────────────────────────────

/**
 * Generate Playwright .spec.ts code from parsed .flow.md result.
 * @param {import('./flow-parser.mjs').FlowParseResult} parsed
 * @returns {string} TypeScript test file content
 */
export function compile(parsed) {
  const lines = [];
  const indent = '  ';

  lines.push("import { test, expect } from '@playwright/test';");
  lines.push('');

  for (const flow of parsed.flows) {
    lines.push(`${indent}test('${escapeStr(parsed.featureName)} - ${escapeStr(flow.id + ' - ' + flow.title)}', async ({ page }) => {`);

    // Preconditions as comments
    if (flow.preconditions) {
      lines.push(`${indent}${indent}// Preconditions:`);
      for (const line of flow.preconditions.split('\n')) {
        lines.push(`${indent}${indent}// ${line}`);
      }
    }

    // AI_REQUIRED marker — skip entire flow if any step needs AI
    const hasAiRequired = flow.steps.some(s =>
      s.description.includes('AI_REQUIRED') || s.description.includes('<!-- AI_REQUIRED -->')
    );
    if (hasAiRequired) {
      lines.push(`${indent}${indent}// AI_REQUIRED — cannot execute natively, AI will handle`);
      lines.push(`${indent}${indent}test.skip();`);
    }

    for (const step of flow.steps) {
      const desc = step.description;

      lines.push(`${indent}${indent}// Step ${step.order}: ${desc.replace(/`/g, '')}`);

      const action = inferAction(desc, step.order);
      if (action.action) {
        const args = action.args.map(a => typeof a === 'string' ? `'${escapeStr(a)}'` : a).join(', ');
        lines.push(`${indent}${indent}await ${action.action}(${args});`);
      } else {
        // Cannot map to Playwright API — keep as TODO comment
        lines.push(`${indent}${indent}// UNSUPPORTED: ${desc}`);
      }

      // Validation points
      for (const validation of step.validations) {
        const va = inferAssertion(validation);
        lines.push(`${indent}${indent}// ✅ ${va.raw}`);

        if (va.assertion === 'toBeVisible') {
          lines.push(`${indent}${indent}await expect(page.locator('${escapeStr(va.args[0])}')).toBeVisible();`);
        } else if (va.assertion === 'toHaveText') {
          lines.push(`${indent}${indent}await expect(page.locator('${escapeStr(va.args[0])}')).toHaveText('${escapeStr(va.args[1])}');`);
        } else if (va.assertion === 'toHaveTitle') {
          lines.push(`${indent}${indent}await expect(page).toHaveTitle(${typeof va.args[0] === 'string' ? `'${escapeStr(va.args[0])}'` : va.args[0]});`);
        } else if (va.assertion === 'toHaveURL') {
          lines.push(`${indent}${indent}await expect(page).toHaveURL(${typeof va.args[0] === 'string' ? `'${escapeStr(va.args[0])}'` : va.args[0]});`);
        }
      }

      lines.push('');
    }

    // Close test block
    lines.push(`${indent}});`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Derive .flow.spec.ts path from .flow.md path.
 */
export function outputPath(flowMdPath) {
  if (flowMdPath.endsWith('.flow.md')) {
    return flowMdPath.slice(0, -7) + 'flow.spec.ts';
  }
  return flowMdPath.replace(/\.md$/, '.flow.spec.ts');
}

/**
 * Parse .flow.md and compile to .spec.ts file.
 * Returns the path to the generated .spec.ts file.
 */
export function compileFromFile(flowMdPath) {
  if (!existsSync(flowMdPath)) {
    throw new Error(`File not found: ${flowMdPath}`);
  }

  const flowContent = readFileSync(flowMdPath, 'utf-8');
  const parsed = parse(flowContent);
  const specContent = compile(parsed);
  const outPath = outputPath(flowMdPath);

  writeFileSync(outPath, specContent, 'utf-8');
  return resolve(outPath);
}

/**
 * Check if the .spec.ts file is up-to-date with the .flow.md file.
 * Returns true if .spec.ts exists and is newer than .flow.md.
 */
export function isUpToDate(flowMdPath) {
  const specPath = outputPath(flowMdPath);
  if (!existsSync(specPath)) return false;
  try {
    const flowTime = statSync(flowMdPath).mtimeMs;
    const specTime = statSync(specPath).mtimeMs;
    return specTime >= flowTime;
  } catch {
    return false;
  }
}

/**
 * Compile all .flow.md files in a directory tree.
 * Returns array of { flowMdPath, specPath, skipped } objects.
 */
export function compileAllFromDir(dirPath) {
  const results = [];
  // Traverse on CLI — SKILL.md calls node with specific paths
  // This function is reserved for future batch compilation
  throw new Error('compileAllFromDir not implemented — call compileFromFile for each .flow.md');
}

// ── Helpers ───────────────────────────────────────────────────────

function escapeStr(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

// ── CLI entry point ───────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node spec-compiler.mjs <path-to-flow.md>');
    process.exit(1);
  }

  // 自动 freshness 检查：如果 .flow.spec.ts 已是最新，跳过编译
  if (isUpToDate(filePath)) {
    const specPath = outputPath(filePath);
    console.log(`⏭ SKIP: ${specPath} is up-to-date`);
    process.exit(0);
  }

  try {
    const outPath = compileFromFile(filePath);
    console.log(`✅ Generated: ${outPath}`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
