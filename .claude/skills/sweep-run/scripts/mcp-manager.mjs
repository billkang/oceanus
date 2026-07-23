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
 */

import { execSync, spawn } from 'node:child_process';

const DEFAULT_PORT = 54321;
const MCP_PACKAGE = '@playwright/mcp';

// ── Process helpers ────────────────────────────────────────────────

/**
 * Find PID of process listening on a given TCP port.
 * Returns null if nothing is listening.
 */
export function findPidByPort(port) {
  try {
    const stdout = execSync(`lsof -ti tcp:${port} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return stdout ? parseInt(stdout.split('\n')[0], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Get the command line of a process by PID.
 */
export function getProcessCommand(pid) {
  try {
    return execSync(`ps -p ${pid} -o args= 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
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
 * Kill a process by PID with escalation (SIGTERM -> SIGKILL).
 */
export function killProcess(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    // Wait briefly for graceful shutdown
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        process.kill(pid, 0); // probe if alive
      } catch {
        return; // process is gone
      }
      execSync('sleep 0.2', { timeout: 1000 });
    }
    // Force kill
    process.kill(pid, 'SIGKILL');
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
    execSync('sleep 1', { timeout: 2000 });
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
    execSync('sleep 0.3', { timeout: 1000 });
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
  const modeFlag = args.find(a => a.startsWith('--mode='));
  const portFlag = args.find(a => a.startsWith('--port='));
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
