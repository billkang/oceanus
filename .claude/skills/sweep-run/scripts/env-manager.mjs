#!/usr/bin/env node

/**
 * Env Manager — 测试环境配置管理
 *
 * 从 .deepstorm/settings.json 读取目标环境配置，输出结构化结果。
 * 支持检查 E2E 框架配置和 MCP 可用性。
 *
 * 所有旧数据源（.env BASE_URL、.sweep-init、scope-config.json 等）
 * 已由 `deepstorm update` 统一迁移到 .deepstorm/settings.json，
 * 本文件无需再做兼容处理。
 *
 * Usage:
 *   node env-manager.mjs --env test                   # 解析指定环境
 *   node env-manager.mjs --env test --print            # 输出 export 语句
 *   node env-manager.mjs --framework                   # 读取 E2E 框架配置
 *   node env-manager.mjs --check-mcp                   # 检查 MCP 服务可用性
 *   node env-manager.mjs --list                        # 列出所有可用环境
 *
 *   import { resolveEnv, listEnvs, readFramework, checkMcpAvailable } from './env-manager.mjs'
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';

// ── Path helpers (lazy, respect process.cwd() changes) ────────────

function getEnvPath() {
  return resolve(process.cwd(), '.env');
}
function getMcpPath() {
  return resolve(process.cwd(), '.mcp.json');
}
function getDeepstormSettingsPath() {
  return resolve(process.cwd(), '.deepstorm', 'settings.json');
}

// ── settings.json reading ─────────────────────────────────────────

/**
 * Read .deepstorm/settings.json and extract environments config.
 * Returns the sweep.environments object or null if not configured.
 */
export function readDeepstormEnvironments() {
  const settingsPath = getDeepstormSettingsPath();
  if (!existsSync(settingsPath)) return null;
  try {
    const content = readFileSync(settingsPath, 'utf-8');
    const config = JSON.parse(content);
    return config.sweep?.environments || null;
  } catch {
    return null;
  }
}

/**
 * Read .deepstorm/settings.json and extract e2eProjectPath.
 * Returns the project path string or null if not configured.
 */
export function readE2eProjectPath() {
  const settingsPath = getDeepstormSettingsPath();
  if (!existsSync(settingsPath)) return null;
  try {
    const content = readFileSync(settingsPath, 'utf-8');
    const config = JSON.parse(content);
    return config.sweep?.e2eProjectPath || null;
  } catch {
    return null;
  }
}

/**
 * Convert settings.json environments format to the same structure
 * that listEnvs() returns from .env, for a unified return format.
 *
 * Input:  { test: { baseUrl: "..." }, staging: { baseUrl: "..." }, default: "test" }
 * Output: { envMap: { BASE_URL_TEST: "...", BASE_URL_STAGING: "...", DEFAULT_ENV: "test" },
 *           defaultEnv: "test" }
 */
function deepstormEnvsToEnvMap(envs) {
  if (!envs) return { envMap: {}, defaultEnv: 'test' };
  const envMap = {};
  const defaultEnv = envs.default || 'test';
  for (const [name, config] of Object.entries(envs)) {
    if (name === 'default') continue;
    if (config && config.baseUrl) {
      envMap[`BASE_URL_${name.toUpperCase()}`] = config.baseUrl;
    }
  }
  envMap.DEFAULT_ENV = defaultEnv;
  return { envMap, defaultEnv };
}

// ── .env parsing ──────────────────────────────────────────────────

/**
 * Parse .env file content into a key-value map.
 * Handles `KEY=VALUE` lines, ignores comments and blank lines.
 */
export function parseDotEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sepIdx = trimmed.indexOf('=');
    if (sepIdx === -1) continue;
    const key = trimmed.slice(0, sepIdx).trim();
    let value = trimmed.slice(sepIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

/**
 * Read and parse .env file. Returns empty object if file doesn't exist.
 */
export function readDotEnv() {
  if (!existsSync(getEnvPath())) return {};
  try {
    const content = readFileSync(getEnvPath(), 'utf-8');
    return parseDotEnv(content);
  } catch {
    return {};
  }
}

/**
 * Get the default environment name from .deepstorm/settings.json.
 * Falls back to 'test' if not configured.
 */
export function getDefaultEnv() {
  const dsEnvs = readDeepstormEnvironments();
  if (dsEnvs && dsEnvs.default) {
    return dsEnvs.default;
  }
  return 'test';
}

/**
 * List all available environments from .deepstorm/settings.json.
 *
 * Reads sweep.environments and returns environment name + URL pairs.
 * Returns empty array if not configured.
 */
export function listEnvs() {
  const dsEnvs = readDeepstormEnvironments();
  if (!dsEnvs) return [];

  const envs = [];
  for (const [name, config] of Object.entries(dsEnvs)) {
    if (name === 'default') continue;
    if (config && config.baseUrl) {
      envs.push({
        name: name.toLowerCase(),
        key: `BASE_URL_${name.toUpperCase()}`,
        url: config.baseUrl,
      });
    }
  }
  return envs;
}

/**
 * Resolve target environment config from .deepstorm/settings.json.
 *
 * @param {string} [envName] - Target environment name (e.g. 'staging', 'test')
 * @returns {{ env: string, baseUrl: string|null, availableEnvs: Array<{name:string,url:string}> }}
 *
 * If envName is omitted, uses DEFAULT_ENV (or 'test').
 * If settings.json has no environments config, baseUrl is null and availableEnvs is empty.
 * If the environment is not found, baseUrl is null and availableEnvs lists alternatives.
 */
export function resolveEnv(envName) {
  const dsEnvs = readDeepstormEnvironments();
  if (!dsEnvs) {
    const name = envName || 'test';
    return { env: name, baseUrl: null, availableEnvs: [] };
  }

  const { envMap, defaultEnv } = deepstormEnvsToEnvMap(dsEnvs);
  const name = envName || defaultEnv;
  const availableEnvs = listEnvs();
  const baseUrlKey = `BASE_URL_${name.toUpperCase()}`;
  const baseUrl = envMap[baseUrlKey] || null;
  return { env: name, baseUrl, availableEnvs };
}

// ── Framework config ──────────────────────────────────────────────

/**
 * Read E2E framework config from .deepstorm/settings.json → sweep.e2eFramework.
 *
 * @returns {{ framework: string|null, source: string }}
 *   framework: 'playwright' | 'cypress' | null
 *   source: 'deepstorm-settings' | 'missing-file' | 'not-configured' | 'parse-error'
 */
export function readFramework() {
  const deepstormPath = resolve(process.cwd(), '.deepstorm', 'settings.json');
  if (!existsSync(deepstormPath)) {
    return { framework: null, source: 'missing-file' };
  }

  try {
    const content = readFileSync(deepstormPath, 'utf-8');
    const config = JSON.parse(content);
    const framework = config.sweep?.e2eFramework || null;
    return { framework, source: framework ? 'deepstorm-settings' : 'not-configured' };
  } catch {
    return { framework: null, source: 'parse-error' };
  }
}

// ── MCP availability ──────────────────────────────────────────────

// ── Project root discovery ──────────────────────────────────────────

/**
 * Walk up from startDir to find .deepstorm/settings.json
 *
 * @param {string} [startDir] - defaults to process.cwd()
 * @returns {string|null} resolved dir containing settings.json, or null
 */
export function resolveProjectRoot(startDir) {
  let dir = startDir ? resolve(startDir) : process.cwd();
  while (true) {
    if (existsSync(resolve(dir, '.deepstorm', 'settings.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Write or update a key in .deepstorm/settings.json.
 *
 * @param {string} keyPath dot-separated path, e.g. "sweep.e2eProjectPath"
 * @param {*} value
 * @returns {boolean}
 */
export function writeDeepstormConfig(keyPath, value) {
  const filePath = resolve(process.cwd(), '.deepstorm', 'settings.json');
  if (!existsSync(filePath)) return false;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content);
    const keys = keyPath.split('.');
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') {
        obj[keys[i]] = {};
      }
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the required MCP service is configured in .mcp.json.
 *
 * @param {string} [mcpName='deepstorm-playwright'] - MCP service name to check
 * @returns {{ available: boolean, mcpName: string }}
 */
export function checkMcpAvailable(mcpName = 'deepstorm-playwright') {
  if (!existsSync(getMcpPath())) {
    return { available: false, mcpName };
  }

  try {
    const content = readFileSync(getMcpPath(), 'utf-8');
    const config = JSON.parse(content);
    const available = !!(config.mcpServers?.[mcpName] || config[mcpName]);
    return { available, mcpName };
  } catch {
    return { available: false, mcpName };
  }
}

// ── CLI entry point ────────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const envs = listEnvs();
    const defaultEnv = getDefaultEnv();
    console.log(JSON.stringify({ default: defaultEnv, environments: envs }));
    process.exit(0);
  }

  if (args.includes('--framework')) {
    const result = readFramework();
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  if (args.includes('--check-mcp')) {
    const mcpName = args.find(a => a.startsWith('--mcp='))?.split('=')[1] || 'deepstorm-playwright';
    const result = checkMcpAvailable(mcpName);
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  if (args.includes('--project-root')) {
    const startIdx = args.indexOf('--project-root');
    const startDir = startIdx + 1 < args.length ? args[startIdx + 1] : undefined;
    const result = resolveProjectRoot(startDir);
    if (result) {
      console.log(JSON.stringify({ found: true, path: result }));
    } else {
      console.log(JSON.stringify({ found: false }));
    }
    process.exit(0);
  }

  if (args.includes('--set-e2e-path')) {
    const idx = args.indexOf('--set-e2e-path');
    const path = idx + 1 < args.length ? args[idx + 1] : '.';
    const ok = writeDeepstormConfig('sweep.e2eProjectPath', path);
    console.log(JSON.stringify({ ok, path }));
    process.exit(0);
  }

  // Default: resolve env
  const envFlag = args.find(a => a.startsWith('--env='));
  const envName = envFlag ? envFlag.split('=')[1] : undefined;
  const result = resolveEnv(envName);

  if (args.includes('--print')) {
    if (result.baseUrl) {
      console.log(`export BASE_URL=${result.baseUrl}`);
    } else {
      console.error(`# No base URL found for environment "${result.env}"`);
      console.error(`# Available: ${result.availableEnvs.map(e => e.name).join(', ')}`);
      process.exit(1);
    }
  } else {
    console.log(JSON.stringify(result));
  }
}
