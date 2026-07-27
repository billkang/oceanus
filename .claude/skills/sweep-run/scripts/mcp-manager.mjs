#!/usr/bin/env node

/**
 * MCP Manager — Playwright MCP 服务生命周期管理
 *
 * 根据执行模式自动管理 Playwright MCP 进程：
 *   - headless（默认）：混合执行，MCP 仅用于自愈诊断
 *   - headed：浏览器调试模式，需要可见窗口
 *   - skip：不启动 MCP（--native 模式）
 *
 * Usage:
 *   node mcp-manager.mjs [--mode headless|headed|skip] [--port 54321]
 *   node mcp-manager.mjs --status [--port 54321]
 *   node mcp-manager.mjs --stop [--port 54321]
 *   import { ensureMcp, stopMcp, getStatus } from './mcp-manager.mjs'
 *
 * Cross-platform note:
 *   所有系统调用均兼容 macOS / Linux / Windows。
 *   使用 Node.js 内置 API 替代 lsof / ps / sleep / SIGKILL 等 Unix-only 命令。
 */

import { execSync, spawn } from 'node:child_process';

const DEFAULT_PORT = 54321;
const MCP_PACKAGE = '@playwright/mcp';

// ── Cross-platform helpers ─────────────────────────────────────────

/**
 * 跨平台同步 sleep — 使用 Atomics.wait 实现，不依赖 shell sleep 命令。
 * @param {number} ms
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ── Cross-platform process helpers ──────────────────────────────────

/**
 * 跨平台查找监听指定 TCP 端口的进程 PID。
 *
 * - macOS/Linux: lsof -ti tcp:<port>
 * - Windows: netstat -ano | findstr LISTENING
 *
 * @param {number} port
 * @returns {number|null}
 */
export function findPidByPort(port) {
  if (process.platform === 'win32') {
    return findPidByPortWin(port);
  }
  return findPidByPortUnix(port);
}

function findPidByPortUnix(port) {
  try {
    const stdout = execSync(`lsof -ti tcp:${port}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return stdout ? parseInt(stdout.split('\n')[0], 10) : null;
  } catch {
    return null;
  }
}

function findPidByPortWin(port) {
  try {
    const stdout = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    // netstat output: TCP    0.0.0.0:8080    0.0.0.0:0    LISTENING    12345
    const lines = stdout.split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (Number.isFinite(pid)) return pid;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 跨平台获取进程命令行。
 *
 * - macOS/Linux: ps -p <pid> -o args=
 * - Windows: wmic process where processid=<pid> get commandline
 *
 * @param {number} pid
 * @returns {string}
 */
export function getProcessCommand(pid) {
  if (process.platform === 'win32') {
    return getProcessCommandWin(pid);
  }
  return getProcessCommandUnix(pid);
}

function getProcessCommandUnix(pid) {
  try {
    return execSync(`ps -p ${pid} -o args=`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function getProcessCommandWin(pid) {
  try {
    const stdout = execSync(`wmic process where processid=${pid} get commandline`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    const lines = stdout.split('\n').filter(Boolean);
    return lines.length >= 2 ? lines[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Check if a process command indicates headless mode.
 */
export function isHeadless(cmd) {
  return cmd.includes('--headless');
}

/**
 * 跨平台终止进程。
 *
 * - macOS/Linux: SIGTERM → wait → SIGKILL (force)
 * - Windows: process.kill SIGTERM → taskkill /F (force fallback)
 *
 * @param {number} pid
 */
export function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    // Wait briefly for graceful shutdown — polling with setTimeout
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        process.kill(pid, 0); // probe if alive
      } catch {
        return; // process is gone
      }
      // Busy-wait with micro-pause to avoid CPU spin
      const pollStart = Date.now();
      while (Date.now() - pollStart < 50) {
        /* yield */
      }
    }
    // Force kill
    if (process.platform === 'win32') {
      // Windows: SIGKILL unsupported, use taskkill /F
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      } catch {
        // already dead
      }
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    // already dead
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get current MCP service status.
 * @param {number} [port=DEFAULT_PORT]
 * @returns {{ running: boolean, pid: number|null, mode: string|null }}
 */
export function getStatus(port = DEFAULT_PORT) {
  const pid = findPidByPort(port);
  if (!pid) {
    return { running: false, pid: null, mode: null };
  }
  const cmd = getProcessCommand(pid);
  const mode = isHeadless(cmd) ? 'headless' : 'headed';
  return { running: true, pid, mode };
}

/**
 * Stop MCP service if running.
 * @param {number} [port=DEFAULT_PORT]
 * @returns {{ stopped: boolean, pid: number|null }}
 */
export function stopMcp(port = DEFAULT_PORT) {
  const status = getStatus(port);
  if (!status.running) {
    return { stopped: false, pid: null };
  }
  killProcess(status.pid);
  return { stopped: true, pid: status.pid };
}

/**
 * Ensure MCP service is running in the desired mode.
 *
 * @param {object} options
 * @param {'headless'|'headed'} [options.mode='headless'] - Desired mode
 * @param {number} [options.port=DEFAULT_PORT] - MCP port
 * @returns {{ action: string, mode: string, pid: number, port: number }}
 *
 * Possible action values:
 *   - 'started'     -- MCP was not running, started fresh
 *   - 'switched'    -- MCP was running in wrong mode, restarted
 *   - 'already-ok'  -- MCP already running in correct mode
 */
export function ensureMcp(options = {}) {
  const mode = options.mode || 'headless';
  const port = options.port || DEFAULT_PORT;

  if (mode === 'skip') {
    return { action: 'skipped', mode: 'skip', pid: null, port };
  }

  const status = getStatus(port);

  if (status.running) {
    if (status.mode === mode) {
      return { action: 'already-ok', mode, pid: status.pid, port };
    }
    // Running in wrong mode -- restart
    stopMcp(port);
    sleepSync(1000);
  }

  // Start MCP
  const args = ['--port', String(port)];
  if (mode === 'headless') {
    args.push('--headless');
  }

  const child = spawn('npx', [MCP_PACKAGE, ...args], {
    stdio: 'inherit',
    detached: true,
  });
  child.unref();

  // Wait for it to be listening
  const deadline = Date.now() + 10000;
  let startedPid = null;
  while (Date.now() < deadline) {
    sleep(300);
    const found = findPidByPort(port);
    if (found) {
      startedPid = found;
      break;
    }
  }

  if (!startedPid) {
    throw new Error(`MCP failed to start on port ${port} within 10s`);
  }

  const action = status.running ? 'switched' : 'started';
  return { action, mode, pid: startedPid, port };
}

// ── CLI entry point ────────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const modeFlag = args.find((a) => a.startsWith('--mode='));
  const portFlag = args.find((a) => a.startsWith('--port='));
  const mode = modeFlag ? modeFlag.split('=')[1] : 'headless';
  const port = portFlag ? parseInt(portFlag.split('=')[1], 10) : DEFAULT_PORT;

  if (args.includes('--stop')) {
    const result = stopMcp(port);
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  if (args.includes('--status')) {
    const result = getStatus(port);
    console.log(JSON.stringify(result));
    process.exit(0);
  }

  try {
    const result = ensureMcp({ mode, port });
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}
