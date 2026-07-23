#!/usr/bin/env node

/**
 * generate-report.mjs
 * 生成格式化的 E2E 测试报告（markdown）。
 *
 * 用法:
 *   node generate-report.mjs --results <json> -o report.md
 *   node generate-report.mjs --help
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Pure functions ────────────────────────────────────────────────

/**
 * 生成 markdown 格式的测试报告
 * @param {object} data
 * @param {string} data.fileName - .flow.md 文件名
 * @param {string} data.timestamp - 执行时间
 * @param {string} data.env - 目标环境名
 * @param {string} data.envUrl - 环境 URL
 * @param {string} data.mode - 执行模式
 * @param {Array} data.flows - [{ id, title, steps: [{n,op,vf,result}] }]
 * @param {number} data.passed - 通过步骤数
 * @param {number} data.failed - 失败步骤数
 * @param {number} data.skipped - 跳过的步骤数
 * @returns {string} markdown 报告内容
 */
export function generateReport(data) {
  const total = data.passed + data.failed + data.skipped;
  const passRate = total > 0
    ? Math.round((data.passed / total) * 100) : 0;

  const lines = [];
  lines.push('# 测试执行报告\n');
  lines.push(`**文件：** ${data.fileName}`);
  lines.push(`**执行时间：** ${data.timestamp}`);
  lines.push(`**目标环境：** ${data.env} (${data.envUrl || '-'})`);
  lines.push(`**执行模式：** ${data.mode}\n`);
  lines.push('---\n');

  for (const flow of data.flows) {
    const status = flow.failed > 0 ? 'X' : 'OK';
    lines.push(`## Flow: ${flow.id} - ${flow.title} ${status}\n`);
    lines.push('| 步骤 | 操作 | 验证 | 结果 |');
    lines.push('|------|------|------|------|');

    for (const step of flow.steps) {
      let resultStr = '';
      if (step.result === 'skip') resultStr = '>';
      else if (step.result === 'pass') resultStr = 'OK';
      else if (step.result === 'fail') resultStr = 'X';
      else resultStr = step.result || '-';

      lines.push(`| ${step.n} | ${step.op} | ${step.vf} | ${resultStr} |`);
    }
    lines.push('');
  }

  lines.push('---\n');
  lines.push('## 汇总\n');
  lines.push('| 项目 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 总 Flows 数 | ${data.flows.length} |`);
  lines.push(`| 总步骤数 | ${total} |`);
  lines.push(`| 通过 | ${data.passed} |`);
  lines.push(`| 失败 | ${data.failed} |`);
  lines.push(`| 跳过 | ${data.skipped} |`);
  lines.push(`| 通过率 | ${passRate}% |\n`);

  return lines.join('\n');
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
generate-report.mjs — 生成测试报告

用法:
  node generate-report.mjs --results <json> -o report.md
  node generate-report.mjs --help
`);
    process.exit(0);
  }

  const resultsIdx = process.argv.indexOf('--results');
  const outIdx = process.argv.indexOf('-o');

  if (resultsIdx < 0) {
    console.error('--results 必填');
    process.exit(1);
  }

  const resultsJson = process.argv[resultsIdx + 1];
  let data;
  try {
    data = JSON.parse(resultsJson);
  } catch {
    console.error('--results 值不是有效 JSON');
    process.exit(1);
  }

  const report = generateReport(data);

  if (outIdx >= 0) {
    const outPath = resolve(process.cwd(), process.argv[outIdx + 1]);
    writeFileSync(outPath, report, 'utf8');
    console.log(JSON.stringify({ written: true, path: outPath }));
  } else {
    process.stdout.write(report + '\n');
  }
}
