import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import net from 'net';
import path from 'path';
import process from 'process';

const require = createRequire(import.meta.url);
const nextCli = require.resolve('next/dist/bin/next');
const electronCli = require.resolve('electron/cli.js');

const ROOT = process.cwd();
const NEXT_LOCK_PATH = path.join(ROOT, '.next', 'dev', 'lock');
const START_PORT = Number(process.env.CLAUDE_USAGE_PORT || 3099);
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port < startPort + 50; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`Could not find an open port starting at ${startPort}`);
}

async function waitForServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await delay(400);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function terminate(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readExistingNextDevLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(NEXT_LOCK_PATH, 'utf8'));
    if (lock?.pid && lock?.port && processExists(lock.pid)) {
      return lock;
    }
  } catch {
    // ignore missing or malformed lock files
  }

  try {
    fs.rmSync(NEXT_LOCK_PATH, { force: true });
  } catch {
    // ignore stale cleanup failures
  }

  return null;
}

async function main() {
  const existingLock = readExistingNextDevLock();
  const port = existingLock?.port ?? (await findAvailablePort(START_PORT));
  const sharedEnv = { ...process.env, CLAUDE_USAGE_PORT: String(port) };

  let nextProcess = null;
  if (existingLock) {
    console.log(`[dev] Reusing existing Next.js dev server on port ${port} (pid ${existingLock.pid})`);
  } else {
    console.log(`[dev] Starting Next.js on port ${port}`);
    nextProcess = spawn(process.execPath, [nextCli, 'dev', '-p', String(port)], {
      cwd: ROOT,
      env: sharedEnv,
      stdio: 'inherit',
    });
  }

  let electronProcess = null;
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminate(electronProcess);
    terminate(nextProcess);
    setTimeout(() => process.exit(code), 150);
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    process.on(signal, () => shutdown(0));
  }

  nextProcess?.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[dev] Next.js exited before Electron finished (code ${code ?? 0})`);
      shutdown(code ?? 1);
    }
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}`);
  } catch (error) {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    shutdown(1);
    return;
  }

  console.log('[dev] Launching Electron');
  electronProcess = spawn(process.execPath, [electronCli, '.'], {
    cwd: ROOT,
    env: sharedEnv,
    stdio: 'inherit',
  });

  electronProcess.on('exit', (code) => {
    if (!shuttingDown) {
      shutdown(code ?? 0);
    }
  });
}

main().catch((error) => {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
