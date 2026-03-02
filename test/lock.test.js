import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rnwt-lock-test-'));
  process.env.RNWT_HOME = tmpDir;
});

afterEach(() => {
  delete process.env.RNWT_HOME;
  rmSync(tmpDir, { recursive: true, force: true });
});

async function loadLock() {
  return import(`../src/lock.js?t=${Date.now()}-${Math.random()}`);
}

async function loadConfig() {
  return import(`../src/config.js?t=${Date.now()}-${Math.random()}`);
}

function writeLockFile(data) {
  writeFileSync(join(tmpDir, 'lock.json'), JSON.stringify(data, null, 2) + '\n');
}

function readLockFile() {
  const p = join(tmpDir, 'lock.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function writeConfigFile(data) {
  writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(data, null, 2) + '\n');
}

describe('lock', () => {
  describe('waitForLock', () => {
    it('acquires free lock', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } });
      const { waitForLock } = await loadLock();

      const result = await waitForLock('feat-a', 'com.test', 'ios');
      assert.equal(result.acquired, true);
      assert.equal(result.switched, true);

      const lock = readLockFile();
      assert.equal(lock.ios.holder, 'feat-a');
      assert.equal(lock.ios.app, 'com.test');
    });

    it('heartbeats when same holder', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } });
      writeLockFile({
        ios: {
          holder: 'feat-a',
          app: 'com.test',
          pid: process.pid,
          updatedAt: new Date().toISOString(),
        },
      });
      const { waitForLock } = await loadLock();

      const result = await waitForLock('feat-a', 'com.test', 'ios');
      assert.equal(result.acquired, true);
      assert.equal(result.switched, false);
    });

    it('takes over stale lock', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } });
      // Lock held by someone else, but timestamp is old
      const staleTime = new Date(Date.now() - 120000).toISOString();
      writeLockFile({
        ios: {
          holder: 'old-agent',
          app: 'com.test',
          pid: 99999,
          updatedAt: staleTime,
        },
      });
      const { waitForLock } = await loadLock();

      const result = await waitForLock('new-agent', 'com.test', 'ios', 60000);
      assert.equal(result.acquired, true);
      assert.equal(result.switched, true);
      assert.equal(result.previousHolder, 'old-agent');

      const lock = readLockFile();
      assert.equal(lock.ios.holder, 'new-agent');
    });

    it('keeps platform locks independent', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios', 'android'], worktrees: {} } } });
      const { waitForLock } = await loadLock();

      await waitForLock('agent-ios', 'com.test', 'ios');
      await waitForLock('agent-android', 'com.test', 'android');

      const lock = readLockFile();
      assert.equal(lock.ios.holder, 'agent-ios');
      assert.equal(lock.android.holder, 'agent-android');
    });
  });

  describe('release', () => {
    it('releases held lock', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } });
      writeLockFile({
        ios: { holder: 'feat-a', app: 'com.test', pid: 1, updatedAt: new Date().toISOString() },
      });
      const { release } = await loadLock();

      const released = release('ios');
      assert.equal(released, true);
      assert.equal(existsSync(join(tmpDir, 'lock.json')), false);
    });

    it('returns false when no lock held', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } });
      const { release } = await loadLock();
      assert.equal(release('ios'), false);
    });

    it('preserves other platform locks on release', async () => {
      writeConfigFile({ apps: { 'com.test': { platforms: ['ios', 'android'], worktrees: {} } } });
      writeLockFile({
        ios: { holder: 'a', app: 'com.test', pid: 1, updatedAt: new Date().toISOString() },
        android: { holder: 'b', app: 'com.test', pid: 2, updatedAt: new Date().toISOString() },
      });
      const { release } = await loadLock();

      release('ios');

      const lock = readLockFile();
      assert.equal(lock.ios, undefined);
      assert.equal(lock.android.holder, 'b');
    });
  });

  describe('getStatus', () => {
    it('returns held:false when no lock', async () => {
      const { getStatus } = await loadLock();
      const status = getStatus('ios');
      assert.equal(status.held, false);
    });

    it('returns status for held platform', async () => {
      const now = new Date().toISOString();
      writeLockFile({
        ios: { holder: 'feat-a', app: 'com.test', pid: 123, updatedAt: now },
      });
      const { getStatus } = await loadLock();

      const status = getStatus('ios');
      assert.equal(status.held, true);
      assert.equal(status.holder, 'feat-a');
      assert.equal(status.app, 'com.test');
      assert.equal(status.pid, 123);
      assert.equal(typeof status.elapsedMs, 'number');
    });

    it('returns all platforms when no filter', async () => {
      const now = new Date().toISOString();
      writeLockFile({
        ios: { holder: 'a', app: 'com.test', pid: 1, updatedAt: now },
        android: { holder: 'b', app: 'com.test', pid: 2, updatedAt: now },
      });
      const { getStatus } = await loadLock();

      const status = getStatus();
      assert.ok(status.ios);
      assert.ok(status.android);
      assert.equal(status.ios.holder, 'a');
      assert.equal(status.android.holder, 'b');
    });

    it('returns empty object when no lock file and no filter', async () => {
      const { getStatus } = await loadLock();
      const status = getStatus();
      assert.deepEqual(status, {});
    });
  });

  describe('lock migration', () => {
    it('migrates old flat lock format', async () => {
      writeConfigFile({
        apps: { 'com.test': { platforms: ['android'], worktrees: {} } },
      });
      const oldLock = {
        holder: 'old-wt',
        pid: 42,
        updatedAt: new Date().toISOString(),
      };
      writeLockFile(oldLock);

      const { getStatus } = await loadLock();
      const status = getStatus('android');
      assert.equal(status.held, true);
      assert.equal(status.holder, 'old-wt');

      // Should be persisted in new format
      const onDisk = readLockFile();
      assert.ok(onDisk.android);
      assert.equal(onDisk.holder, undefined);
    });
  });
});
