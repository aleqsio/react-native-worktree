import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

const LOCK_PATH = join(CONFIG_DIR, 'lock.json');

function readLock() {
  if (!existsSync(LOCK_PATH)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeLock(holder) {
  writeFileSync(LOCK_PATH, JSON.stringify({
    holder,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  }, null, 2) + '\n');
}

function isStale(lock, timeoutMs) {
  const elapsed = Date.now() - new Date(lock.updatedAt).getTime();
  return elapsed > timeoutMs;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForLock(worktreeName, timeoutMs = 60000) {
  while (true) {
    const lock = readLock();

    // Free → acquire
    if (!lock) {
      writeLock(worktreeName);
      return { acquired: true, switched: true };
    }

    // Same holder → heartbeat
    if (lock.holder === worktreeName) {
      writeLock(worktreeName);
      return { acquired: true, switched: false };
    }

    // Different holder + stale → take over
    if (isStale(lock, timeoutMs)) {
      const previousHolder = lock.holder;
      writeLock(worktreeName);
      return { acquired: true, switched: true, previousHolder };
    }

    // Different holder + fresh → wait
    const elapsed = Date.now() - new Date(lock.updatedAt).getTime();
    const remaining = Math.ceil((timeoutMs - elapsed) / 1000);
    process.stderr.write(`Waiting for '${lock.holder}' to release (stale in ~${remaining}s)...\n`);
    await sleep(1000);
  }
}

export function release() {
  if (existsSync(LOCK_PATH)) {
    unlinkSync(LOCK_PATH);
    return true;
  }
  return false;
}

export function getStatus() {
  const lock = readLock();
  if (!lock) {
    return { held: false };
  }
  const elapsed = Date.now() - new Date(lock.updatedAt).getTime();
  return {
    held: true,
    holder: lock.holder,
    pid: lock.pid,
    updatedAt: lock.updatedAt,
    elapsedMs: elapsed,
  };
}
