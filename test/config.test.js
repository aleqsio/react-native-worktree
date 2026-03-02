import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rnwt-test-'));
  process.env.RNWT_HOME = tmpDir;
});

afterEach(() => {
  delete process.env.RNWT_HOME;
  rmSync(tmpDir, { recursive: true, force: true });
});

// Dynamic import to pick up RNWT_HOME each time
async function load() {
  // Bust module cache by using a query param
  const mod = await import(`../src/config.js?t=${Date.now()}-${Math.random()}`);
  return mod;
}

describe('config', () => {
  describe('loadConfig', () => {
    it('returns null when no config exists', async () => {
      const { loadConfig } = await load();
      assert.equal(loadConfig(), null);
    });

    it('loads existing config', async () => {
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { loadConfig } = await load();
      const loaded = loadConfig();
      assert.deepEqual(loaded, config);
    });

    it('migrates old single-app format', async () => {
      const old = {
        bundleId: 'com.old.app',
        platform: 'android',
        worktrees: { main: { path: '/tmp/main', port: 8081 } },
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(old));
      const { loadConfig } = await load();
      const migrated = loadConfig();

      assert.ok(migrated.apps);
      assert.ok(migrated.apps['com.old.app']);
      assert.deepEqual(migrated.apps['com.old.app'].platforms, ['android']);
      assert.deepEqual(migrated.apps['com.old.app'].worktrees, {
        main: { path: '/tmp/main', port: 8081 },
      });

      // Should have been persisted
      const onDisk = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      assert.ok(onDisk.apps);
      assert.equal(onDisk.bundleId, undefined);
    });

    it('migration defaults platform to ios', async () => {
      const old = { bundleId: 'com.test', worktrees: {} };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(old));
      const { loadConfig } = await load();
      const migrated = loadConfig();
      assert.deepEqual(migrated.apps['com.test'].platforms, ['ios']);
    });
  });

  describe('saveConfig', () => {
    it('creates config directory and file', async () => {
      // Point to a subdirectory that doesn't exist yet
      const subDir = join(tmpDir, 'sub', 'dir');
      process.env.RNWT_HOME = subDir;
      const { saveConfig, loadConfig } = await load();
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      saveConfig(config);
      const loaded = loadConfig();
      assert.deepEqual(loaded, config);
    });
  });

  describe('getApp', () => {
    it('returns app when it exists', async () => {
      const { getApp } = await load();
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      assert.deepEqual(getApp(config, 'com.test'), { platforms: ['ios'], worktrees: {} });
    });

    it('returns null for missing app', async () => {
      const { getApp } = await load();
      const config = { apps: {} };
      assert.equal(getApp(config, 'com.missing'), null);
    });
  });

  describe('resolveApp', () => {
    it('returns null for empty config', async () => {
      const { resolveApp } = await load();
      assert.equal(resolveApp(null), null);
      assert.equal(resolveApp({ apps: null }), null);
    });

    it('returns explicit bundleId if it exists', async () => {
      const { resolveApp } = await load();
      const config = { apps: { 'com.test': {} } };
      assert.equal(resolveApp(config, 'com.test'), 'com.test');
    });

    it('returns null for explicit bundleId that does not exist', async () => {
      const { resolveApp } = await load();
      const config = { apps: { 'com.test': {} } };
      assert.equal(resolveApp(config, 'com.missing'), null);
    });

    it('auto-selects single app', async () => {
      const { resolveApp } = await load();
      const config = { apps: { 'com.only': { platforms: ['ios'] } } };
      assert.equal(resolveApp(config), 'com.only');
    });

    it('returns null for multiple apps without bundleId', async () => {
      const { resolveApp } = await load();
      const config = { apps: { 'com.one': {}, 'com.two': {} } };
      assert.equal(resolveApp(config), null);
    });
  });

  describe('getAllPorts', () => {
    it('returns empty array for null config', async () => {
      const { getAllPorts } = await load();
      assert.deepEqual(getAllPorts(null), []);
      assert.deepEqual(getAllPorts({}), []);
    });

    it('collects ports across all apps', async () => {
      const { getAllPorts } = await load();
      const config = {
        apps: {
          'com.a': { worktrees: { w1: { port: 8081 }, w2: { port: 8082 } } },
          'com.b': { worktrees: { w3: { port: 9000 } } },
        },
      };
      const ports = getAllPorts(config);
      assert.deepEqual(ports.sort(), [8081, 8082, 9000]);
    });
  });

  describe('computeNextPort', () => {
    it('returns 8082 with no existing ports', async () => {
      const { computeNextPort } = await load();
      assert.equal(computeNextPort({ apps: {} }), 8082);
    });

    it('returns max + 1', async () => {
      const { computeNextPort } = await load();
      const config = {
        apps: {
          'com.a': { worktrees: { w1: { port: 8081 }, w2: { port: 8085 } } },
        },
      };
      assert.equal(computeNextPort(config), 8086);
    });

    it('never goes below 8082', async () => {
      const { computeNextPort } = await load();
      const config = {
        apps: { 'com.a': { worktrees: { w1: { port: 8080 } } } },
      };
      // max(8080, 8081) + 1 = 8082
      assert.equal(computeNextPort(config), 8082);
    });
  });

  describe('addWorktree', () => {
    it('adds worktree to existing app', async () => {
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { addWorktree, loadConfig } = await load();

      const wt = addWorktree('com.test', 'feat-x', '/tmp/feat-x', 9001);
      assert.equal(wt.port, 9001);
      assert.equal(wt.path, '/tmp/feat-x');

      // Verify persisted
      const loaded = loadConfig();
      assert.equal(loaded.apps['com.test'].worktrees['feat-x'].port, 9001);
    });

    it('auto-assigns port when not given', async () => {
      const config = {
        apps: { 'com.test': { platforms: ['ios'], worktrees: { main: { path: '/tmp', port: 8081 } } } },
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { addWorktree } = await load();

      const wt = addWorktree('com.test', 'feat-y', '/tmp/feat-y');
      assert.equal(wt.port, 8082);
    });

    it('throws for uninitialized config', async () => {
      const { addWorktree } = await load();
      assert.throws(() => addWorktree('com.test', 'x', '/tmp', 8082), /Not initialized/);
    });

    it('throws for missing app', async () => {
      const config = { apps: { 'com.other': { platforms: ['ios'], worktrees: {} } } };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { addWorktree } = await load();
      assert.throws(() => addWorktree('com.missing', 'x', '/tmp', 8082), /not found/);
    });
  });

  describe('getWorktree', () => {
    it('returns worktree when it exists', async () => {
      const config = {
        apps: { 'com.test': { platforms: ['ios'], worktrees: { main: { path: '/tmp', port: 8081 } } } },
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { getWorktree } = await load();
      const wt = getWorktree('com.test', 'main');
      assert.equal(wt.port, 8081);
    });

    it('returns null for missing worktree', async () => {
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { getWorktree } = await load();
      assert.equal(getWorktree('com.test', 'missing'), null);
    });

    it('returns null when no config exists', async () => {
      const { getWorktree } = await load();
      assert.equal(getWorktree('com.test', 'main'), null);
    });
  });
});
