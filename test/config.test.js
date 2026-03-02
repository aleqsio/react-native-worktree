import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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

  describe('getPackageName', () => {
    it('returns androidPackage for android platform when set', async () => {
      const { getPackageName } = await load();
      const app = { platforms: ['ios', 'android'], androidPackage: 'com.test.myapp', worktrees: {} };
      assert.equal(getPackageName(app, 'com.test.my-app', 'android'), 'com.test.myapp');
    });

    it('falls back to bundleId for android when androidPackage not set', async () => {
      const { getPackageName } = await load();
      const app = { platforms: ['android'], worktrees: {} };
      assert.equal(getPackageName(app, 'com.test.app', 'android'), 'com.test.app');
    });

    it('always returns bundleId for ios regardless of androidPackage', async () => {
      const { getPackageName } = await load();
      const app = { platforms: ['ios', 'android'], androidPackage: 'com.test.myapp', worktrees: {} };
      assert.equal(getPackageName(app, 'com.test.my-app', 'ios'), 'com.test.my-app');
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
      assert.throws(() => addWorktree('com.test', 'x', '/tmp', 8082), /No config found/);
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

  describe('ensureConfig', () => {
    it('returns existing config when present', async () => {
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(config));
      const { ensureConfig } = await load();
      const result = ensureConfig();
      assert.deepEqual(result, config);
    });

    it('creates empty config when none exists', async () => {
      const { ensureConfig } = await load();
      const result = ensureConfig();
      assert.deepEqual(result, { apps: {} });
      // Verify persisted
      const onDisk = JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
      assert.deepEqual(onDisk, { apps: {} });
    });
  });

  describe('detectBundleId', () => {
    it('detects iOS bundle ID from app.json', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        writeFileSync(join(tmpDir, 'app.json'), JSON.stringify({
          expo: { ios: { bundleIdentifier: 'com.test.ios' } },
        }));
        const { detectBundleId } = await load();
        assert.equal(detectBundleId('ios'), 'com.test.ios');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('detects Android package from app.json', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        writeFileSync(join(tmpDir, 'app.json'), JSON.stringify({
          expo: { android: { package: 'com.test.android' } },
        }));
        const { detectBundleId } = await load();
        assert.equal(detectBundleId('android'), 'com.test.android');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('returns null when no config files exist', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const { detectBundleId } = await load();
        assert.equal(detectBundleId('ios'), null);
      } finally {
        process.chdir(origCwd);
      }
    });
  });

  describe('ensureApp', () => {
    it('returns existing single app', async () => {
      const { ensureApp } = await load();
      const config = { apps: { 'com.test': { platforms: ['ios'], worktrees: {} } } };
      const result = ensureApp(config);
      assert.equal(result.bundleId, 'com.test');
    });

    it('returns explicit bundleId when it exists', async () => {
      const { ensureApp } = await load();
      const config = { apps: { 'com.a': {}, 'com.b': {} } };
      const result = ensureApp(config, 'com.b');
      assert.equal(result.bundleId, 'com.b');
    });

    it('returns null for explicit bundleId that does not exist', async () => {
      const { ensureApp } = await load();
      const config = { apps: { 'com.a': {} } };
      const result = ensureApp(config, 'com.missing');
      assert.equal(result.bundleId, null);
    });

    it('auto-detects and creates app when no apps exist', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        writeFileSync(join(tmpDir, 'app.json'), JSON.stringify({
          expo: { ios: { bundleIdentifier: 'com.new.app' } },
        }));
        writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({ apps: {} }));
        const { ensureApp } = await load();
        const config = { apps: {} };
        const result = ensureApp(config);
        assert.equal(result.bundleId, 'com.new.app');
        assert.ok(result.config.apps['com.new.app']);
        assert.deepEqual(result.config.apps['com.new.app'].platforms, ['ios']);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('returns null when no apps and no detection possible', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const { ensureApp } = await load();
        const config = { apps: {} };
        const result = ensureApp(config);
        assert.equal(result.bundleId, null);
      } finally {
        process.chdir(origCwd);
      }
    });

    it('returns null for multiple apps without explicit bundleId', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const { ensureApp } = await load();
        const config = { apps: { 'com.a': {}, 'com.b': {} } };
        const result = ensureApp(config);
        assert.equal(result.bundleId, null);
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
