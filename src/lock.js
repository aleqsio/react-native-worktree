import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getConfigDir, loadConfig } from './config.js';

function getLockPath() {
  return join(getConfigDir(), 'lock.json');
}

function readLock() {
  if (!existsSync(getLockPath())) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(getLockPath(), 'utf-8'));
    return migrateLock(data);
  } catch {
    return null;
  }
}

function migrateLock(data) {
  // Old format: { holder, pid, updatedAt } → wrap under detected platform
  if (data && data.holder && !isNewFormat(data)) {
    const config = loadConfig();
    const platform = detectPlatformFromConfig(config) || 'ios';
    const migrated = {
      [platform]: {
        holder: data.holder,
        app: detectAppFromConfig(config),
        pid: data.pid,
        updatedAt: data.updatedAt,
      },
    };
    writeLockRaw(migrated);
    return migrated;
  }
  return data;
}

function isNewFormat(data) {
  // New format has platform keys (ios/android) at top level
  return data.ios !== undefined || data.android !== undefined;
}

function detectPlatformFromConfig(config) {
  if (!config?.apps) return 'ios';
  for (const app of Object.values(config.apps)) {
    if (app.platforms?.length > 0) return app.platforms[0];
  }
  return 'ios';
}

function detectAppFromConfig(config) {
  if (!config?.apps) return null;
  const appIds = Object.keys(config.apps);
  return appIds.length > 0 ? appIds[0] : null;
}

function writeLockRaw(data) {
  writeFileSync(getLockPath(), JSON.stringify(data, null, 2) + '\n');
}

function writePlatformLock(platform, holder, bundleId) {
  const data = readLock() || {};
  data[platform] = {
    holder,
    app: bundleId,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
  };
  writeLockRaw(data);
}

function isStale(entry, timeoutMs) {
  const elapsed = Date.now() - new Date(entry.updatedAt).getTime();
  return elapsed > timeoutMs;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForLock(worktreeName, bundleId, platform, timeoutMs = 60000) {
  while (true) {
    const data = readLock() || {};
    const entry = data[platform];

    // Free → acquire
    if (!entry) {
      writePlatformLock(platform, worktreeName, bundleId);
      return { acquired: true, switched: true };
    }

    // Same holder → heartbeat
    if (entry.holder === worktreeName) {
      writePlatformLock(platform, worktreeName, bundleId);
      return { acquired: true, switched: false };
    }

    // Different holder + stale → take over
    if (isStale(entry, timeoutMs)) {
      const previousHolder = entry.holder;
      writePlatformLock(platform, worktreeName, bundleId);
      return { acquired: true, switched: true, previousHolder };
    }

    // Different holder + fresh → wait
    const elapsed = Date.now() - new Date(entry.updatedAt).getTime();
    const remaining = Math.ceil((timeoutMs - elapsed) / 1000);
    process.stderr.write(`[${platform}] Waiting for '${entry.holder}' to release (stale in ~${remaining}s)...\n`);
    await sleep(1000);
  }
}

export function release(platform) {
  const data = readLock();
  if (!data || !data[platform]) {
    return false;
  }
  delete data[platform];
  // Delete file if empty, otherwise write back
  const remaining = Object.keys(data).length;
  if (remaining === 0) {
    unlinkSync(getLockPath());
  } else {
    writeLockRaw(data);
  }
  return true;
}

export function getStatus(platform) {
  const data = readLock();
  if (!data) {
    return platform ? { held: false } : {};
  }

  if (platform) {
    const entry = data[platform];
    if (!entry) return { held: false };
    const elapsed = Date.now() - new Date(entry.updatedAt).getTime();
    return {
      held: true,
      holder: entry.holder,
      app: entry.app,
      pid: entry.pid,
      updatedAt: entry.updatedAt,
      elapsedMs: elapsed,
    };
  }

  // All platforms
  const result = {};
  for (const [plat, entry] of Object.entries(data)) {
    const elapsed = Date.now() - new Date(entry.updatedAt).getTime();
    result[plat] = {
      held: true,
      holder: entry.holder,
      app: entry.app,
      pid: entry.pid,
      updatedAt: entry.updatedAt,
      elapsedMs: elapsed,
    };
  }
  return result;
}
