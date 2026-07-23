#!/usr/bin/env node

/**
 * init-project.mjs
 * 初始化 E2E 测试项目骨架。
 *
 * 用法:
 *   node init-project.mjs                 # 在当前目录
 *   node init-project.mjs --dir e2e       # 指定子目录
 *   node init-project.mjs --framework playwright
 *   node init-project.mjs --help
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

// ── Template writers ──────────────────────────────────────────────

function writePackageJson(targetDir, framework) {
  const deps = {
    '@inquirer/checkbox': '^4.0.0',
    '@types/node': '^22.0.0',
  };
  if (framework === 'playwright') {
    deps['@playwright/test'] = '^1.50.0';
  }
  const scripts = { report: 'playwright show-report' };
  if (framework === 'playwright') {
    scripts.test = 'playwright test';
  }

  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: 'sweep-e2e',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts,
    devDependencies: deps,
  }, null, 2) + '\n');
}

function writePlaywrightConfig(targetDir) {
  writeFileSync(join(targetDir, 'playwright.config.ts'), [
    "import { defineConfig } from '@playwright/test';",
    '',
    'export default defineConfig({',
    '  use: {',
    "    baseURL: process.env.BASE_URL || 'http://localhost:3000',",
    '  },',
    '  timeout: 30000,',
    '  retries: 0,',
    "  reporter: [['line'], ['html', { outputFolder: 'flows/reports' }]],",
    '  projects: [',
    "    { name: 'chromium', use: { browserName: 'chromium' } },",
    '  ],',
    '});',
    '',
  ].join('\n'));
}

function writeTsconfig(targetDir) {
  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
    },
  }, null, 2) + '\n');
}

function writeTopologyYaml(targetDir) {
  writeFileSync(join(targetDir, 'flows', 'topology.yaml'), [
    '# flows/topology.yaml',
    'name: E2E 测试拓扑',
    'version: 1',
    'modules:',
    '  - name: example',
    '    description: 示例模块',
    '    children:',
    '      - name: feature1',
    '        description: 功能 1',
    '        features: []',
    '',
  ].join('\n'));
}

// ── Main ──────────────────────────────────────────────────────────

export function initProject(opts = {}) {
  const {
    framework = null,   // 'playwright' | null
    dir = '.',
  } = opts;

  const targetDir = resolve(process.cwd(), dir);
  const flowsDir = join(targetDir, 'flows');
  const reportsDir = join(flowsDir, 'reports');
  const scriptsDir = join(targetDir, 'scripts');

  // 创建目录
  mkdirSync(flowsDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });

  // 写入配置文件
  writePackageJson(targetDir, framework);
  writeTsconfig(targetDir);

  if (framework === 'playwright') {
    writePlaywrightConfig(targetDir);
  }

  if (!existsSync(join(flowsDir, 'topology.yaml'))) {
    writeTopologyYaml(targetDir);
  }

  // npm install
  try {
    execSync('npm install', {
      cwd: targetDir,
      stdio: 'pipe',
      timeout: 60000,
    });
  } catch {
    // npm install 失败不阻塞
  }

  const created = [
    'flows/', 'flows/reports/', 'scripts/',
    'package.json', 'tsconfig.json',
  ];
  if (framework === 'playwright') created.push('playwright.config.ts');
  if (!existsSync(join(flowsDir, 'topology.yaml'))) {
    created.push('flows/topology.yaml');
  }

  return { dir: targetDir, created, framework };
}

// ── CLI entry ─────────────────────────────────────────────────────

if (import.meta.filename === process.argv[1]) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
init-project.mjs — E2E 测试项目初始化

用法:
  node init-project.mjs                         当前目录
  node init-project.mjs --dir e2e               指定子目录
  node init-project.mjs --framework playwright   指定框架
  node init-project.mjs --help
`);
    process.exit(0);
  }

  const dirIdx = process.argv.indexOf('--dir');
  const fwIdx = process.argv.indexOf('--framework');
  const result = initProject({
    dir: dirIdx >= 0 ? process.argv[dirIdx + 1] : '.',
    framework: fwIdx >= 0 ? process.argv[fwIdx + 1] : null,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
