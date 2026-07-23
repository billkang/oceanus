#!/usr/bin/env node

/**
 * Flow Parser — 结构化解析 .flow.md 文件
 *
 * 读取 .flow.md 文件，提取 frontmatter、场景清单、Flow 步骤和验证点，
 * 输出结构化 JSON 供下游编译器和执行器使用。
 *
 * Usage:
 *   node flow-parser.mjs <path-to-flow.md>        # CLI: output JSON to stdout
 *   import { parseFlowMd } from './flow-parser.mjs'  # API
 */

import { readFileSync, existsSync } from 'node:fs';

// ── Regex patterns ────────────────────────────────────────────────
// Frontmatter
const FEATURE_NAME_RE = /^#\s+(?:E2E 测试流程[：:]\s*)?(.+)$/m;
const SOURCE_RE = /\*\*来源[：:]\*\*\s*(.+)/;
const CREATED_AT_RE = /\*\*创建时间[：:]\*\*\s*(.+)/;

// Scenario table (Markdown table with | ID | 场景 | 类型 | 优先级 |)
// Matches rows after the header separator (|---|---|---)
const SCENARIO_TABLE_SECTION = /## 场景清单\s*\n(.*?)(?=\n## |\n*$)/s;
const SCENARIO_ROW_RE = /^\|\s*([A-Z0-9]+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(P[0-9])\s*\|/m;

// Flow sections
const FLOW_SECTION_RE = /## Flow:\s*(\S+)\s*-\s*(.+?)\s*\n/g;

// Sub-sections within a flow
const PRECONDITIONS_RE = /###\s*前置条件\s*\n([\s\S]*?)(?=\n###|\n*$)/;
const EXECUTION_STEPS_RE = /###\s*执行步骤\s*\n([\s\S]*?)(?=\n###|\n*$)/;
const ENV_REQUIREMENTS_RE = /###\s*环境要求\s*\n([\s\S]*?)(?=\n##|\n*$)/;

// Step lines: "N. description" with optional validation points
const STEP_LINE_RE = /^\s*(\d+)\.\s+(.+?)(?:\s*\n|$)/m;
const VALIDATION_RE = /✅\s*验证点[：:]\s*(.+?)(?=\n|$)/g;

// ── Parsing functions ─────────────────────────────────────────────

/**
 * Parse frontmatter from .flow.md content.
 */
function parseFrontmatter(content) {
  const featureName = (content.match(FEATURE_NAME_RE)?.[1] || '').trim();
  const source = (content.match(SOURCE_RE)?.[1] || '').trim();
  const createdAt = (content.match(CREATED_AT_RE)?.[1] || '').trim();
  return { featureName, source, createdAt };
}

/**
 * Parse the scenario table from .flow.md content.
 */
function parseScenarios(content) {
  const sectionMatch = content.match(SCENARIO_TABLE_SECTION);
  if (!sectionMatch) return [];

  const tableText = sectionMatch[1];
  const scenarios = [];
  const lines = tableText.split('\n');

  let inBody = false;
  for (const line of lines) {
    // Skip header and separator
    if (/^\|[-]+\|/.test(line) && line.includes('---')) { inBody = true; continue; }
    if (!inBody) continue;

    const m = line.match(SCENARIO_ROW_RE);
    if (m) {
      scenarios.push({
        id: m[1],
        scenario: m[2].trim(),
        type: m[3].trim(),
        priority: m[4],
      });
    }
  }

  return scenarios;
}

/**
 * Parse validation points from a step block.
 */
function parseValidations(text) {
  const validations = [];
  let m;
  while ((m = VALIDATION_RE.exec(text)) !== null) {
    validations.push(m[1].trim());
  }
  return validations;
}

/**
 * Parse steps within an execution steps block.
 */
function parseSteps(stepsContent) {
  if (!stepsContent) return [];

  const steps = [];
  // Split by numbered lines
  const lines = stepsContent.split('\n');
  let currentOrder = null;
  let currentDesc = '';
  let currentBlock = '';

  for (const line of lines) {
    const stepMatch = line.match(STEP_LINE_RE);
    if (stepMatch) {
      // Save previous step
      if (currentOrder !== null) {
        steps.push({
          order: currentOrder,
          description: currentDesc.trim(),
          validations: parseValidations(currentBlock),
        });
      }
      currentOrder = parseInt(stepMatch[1], 10);
      currentDesc = stepMatch[2].trim();
      currentBlock = line;
    } else if (currentOrder !== null) {
      currentBlock += '\n' + line;
    }
  }

  // Save last step
  if (currentOrder !== null) {
    steps.push({
      order: currentOrder,
      description: currentDesc.trim(),
      validations: parseValidations(currentBlock),
    });
  }

  return steps;
}

/**
 * Parse environment requirements.
 */
function parseEnvRequirements(envContent) {
  if (!envContent) return undefined;

  const lines = envContent.trim().split('\n');
  const env = {};

  for (const line of lines) {
    const trimmed = line.replace(/^-\s*/, '').trim();
    if (trimmed.startsWith('目标环境')) {
      const [, value] = trimmed.split(/[：:]/);
      if (value) env.targetEnv = value.trim();
    }
  }

  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * Parse all flows from .flow.md content.
 */
function parseFlows(content) {
  const flows = [];

  // Split around each "## Flow:" heading
  const flowHeadings = [...content.matchAll(FLOW_SECTION_RE)];
  if (flowHeadings.length === 0) return flows;

  for (let i = 0; i < flowHeadings.length; i++) {
    const heading = flowHeadings[i];
    const id = heading[1];
    const title = heading[2].trim();

    // Get content between this flow heading and the next, or end of file
    const startIdx = heading.index + heading[0].length;
    const endIdx = i + 1 < flowHeadings.length
      ? flowHeadings[i + 1].index
      : content.length;
    const flowContent = content.slice(startIdx, endIdx);

    const preconditionsMatch = flowContent.match(PRECONDITIONS_RE);
    const stepsMatch = flowContent.match(EXECUTION_STEPS_RE);
    const envMatch = flowContent.match(ENV_REQUIREMENTS_RE);

    const flow = { id, title };

    if (preconditionsMatch) {
      const precondLines = preconditionsMatch[1]
        .split('\n')
        .map(l => l.replace(/^-\s*/, '').trim())
        .filter(l => l.length > 0);
      flow.preconditions = precondLines.join('\n');
    }

    if (stepsMatch) {
      flow.steps = parseSteps(stepsMatch[1]);
    } else {
      flow.steps = [];
    }

    if (envMatch) {
      flow.envRequirements = parseEnvRequirements(envMatch[1]);
    }

    flows.push(flow);
  }

  return flows;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * JSON Schema for FlowParseResult.
 * Describes the output contract of the parser.
 */
export const FlowParseResultSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'FlowParseResult',
  description: 'Parsed .flow.md document structure',
  type: 'object',
  required: ['featureName', 'source', 'createdAt', 'scenarios', 'flows'],
  properties: {
    featureName: { type: 'string', description: '功能名称（从 # 标题提取）' },
    source: { type: 'string', description: '来源（Issue/PRD 链接）' },
    createdAt: { type: 'string', description: '创建时间' },
    scenarios: {
      type: 'array',
      description: '场景清单',
      items: {
        type: 'object',
        required: ['id', 'scenario', 'type', 'priority'],
        properties: {
          id: { type: 'string', pattern: '^[A-Z0-9]+$', description: '场景 ID（如 L01）' },
          scenario: { type: 'string', description: '场景描述' },
          type: { type: 'string', description: '场景类型（正常流程/边界条件/异常场景）' },
          priority: { type: 'string', pattern: '^P[0-9]$', description: '优先级（P0-P3）' },
        },
      },
    },
    flows: {
      type: 'array',
      description: 'Flow 列表',
      items: {
        type: 'object',
        required: ['id', 'title', 'steps'],
        properties: {
          id: { type: 'string', description: 'Flow ID' },
          title: { type: 'string', description: 'Flow 标题' },
          preconditions: { type: 'string', description: '前置条件描述' },
          steps: {
            type: 'array',
            description: '执行步骤',
            items: {
              type: 'object',
              required: ['order', 'description', 'validations'],
              properties: {
                order: { type: 'integer', description: '步骤序号' },
                description: { type: 'string', description: '步骤描述' },
                validations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '验证点列表',
                },
              },
            },
          },
          envRequirements: {
            type: 'object',
            description: '环境要求',
            properties: {
              targetEnv: { type: 'string', description: '目标环境（test/staging/prod）' },
            },
          },
        },
      },
    },
  },
};

/**
 * Parse a .flow.md file and return structured result.
 * @param {string} filePath - Path to .flow.md file
 * @returns {import('./types').FlowParseResult}
 */
export function parseFlowMd(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  return parse(content);
}

/**
 * Parse raw .flow.md content (no file I/O).
 * @param {string} content - Raw .flow.md content
 * @returns {import('./types').FlowParseResult}
 */
export function parse(content) {
  const frontmatter = parseFrontmatter(content);
  const scenarios = parseScenarios(content);
  const flows = parseFlows(content);

  return {
    featureName: frontmatter.featureName,
    source: frontmatter.source,
    createdAt: frontmatter.createdAt,
    scenarios,
    flows,
  };
}

// ── CLI entry point ───────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node flow-parser.mjs <path-to-flow.md>');
    process.exit(1);
  }

  try {
    const result = parseFlowMd(filePath);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
