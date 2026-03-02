import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.js');

let tmpDir;

function run(args, opts = {}) {
  const env = { ...process.env, RNWT_HOME: tmpDir, NO_COLOR: '1' };
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf-8',
      env,
      cwd: opts.cwd || tmpDir,
      timeout: 10000,
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err) {
    return {
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || '').trim(),
      exitCode: err.status || 1,
    };
  }
}

function readConfig() {
  return JSON.parse(readFileSync(join(tmpDir, 'config.json'), 'utf-8'));
}

function readLock() {
  const p = join(tmpDir, 'lock.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

function writeAppJson(dir, expo) {
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo }));
}

function seedConfig(apps) {
  writeFileSync(join(tmpDir, 'config.json'), JSON.stringify({ apps }));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rnwt-cli-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CLI', () => {
  describe('add', () => {
    it('auto-detects app from app.json on first run', () => {
      writeAppJson(tmpDir, { ios: { bundleIdentifier: 'com.detected' } });
      const { exitCode, stdout } = run(['add', 'feat-a', '--path', '/tmp/feat-a', '--port', '9001'], { cwd: tmpDir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('feat-a'));
      assert.ok(stdout.includes('9001'));

      const config = readConfig();
      assert.ok(config.apps['com.detected']);
      assert.equal(config.apps['com.detected'].worktrees['feat-a'].port, 9001);
    });

    it('auto-detects both platforms from app.json', () => {
      writeAppJson(tmpDir, {
        ios: { bundleIdentifier: 'com.test.my-app' },
        android: { package: 'com.test.myapp' },
      });
      const { exitCode } = run(['add', 'feat-a', '--path', '/tmp/feat-a', '--port', '9001'], { cwd: tmpDir });
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.deepEqual(config.apps['com.test.my-app'].platforms, ['ios', 'android']);
      assert.equal(config.apps['com.test.my-app'].androidPackage, 'com.test.myapp');
    });

    it('adds a worktree with explicit port to existing app', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      const { exitCode, stdout } = run(['add', 'feat-a', '--path', '/tmp/feat-a', '--port', '9001']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('feat-a'));
      assert.ok(stdout.includes('9001'));

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['feat-a'].port, 9001);
    });

    it('auto-assigns port', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      const { exitCode } = run(['add', 'feat-b', '--path', '/tmp/feat-b']);
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['feat-b'].port, 8082);
    });

    it('registers multiple worktrees with explicit ports', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      run(['add', 'w1', '--path', '/tmp/w1', '--port', '8081']);
      run(['add', 'w2', '--path', '/tmp/w2', '--port', '8082']);

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['w1'].port, 8081);
      assert.equal(config.apps['com.test'].worktrees['w2'].port, 8082);
    });

    it('re-add with same name reassigns a new port', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      run(['add', 'feat-a', '--path', '/tmp/feat-a']);
      const config1 = readConfig();
      const port1 = config1.apps['com.test'].worktrees['feat-a'].port;

      // Re-add same worktree name — should get a different port
      run(['add', 'feat-a', '--path', '/tmp/feat-a']);
      const config2 = readConfig();
      const port2 = config2.apps['com.test'].worktrees['feat-a'].port;

      assert.notEqual(port1, port2);
    });

    it('port reclamation removes stale worktree entry', () => {
      // Use a high port that's almost certainly not in use
      seedConfig({
        'com.test': {
          platforms: ['ios'],
          worktrees: { 'old-wt': { path: '/tmp/old', port: 59123 } },
        },
      });

      // Add a new worktree — should reclaim port 59123 and remove old-wt
      const { exitCode, stdout } = run(['add', 'new-wt', '--path', '/tmp/new']);
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['new-wt'].port, 59123);
      assert.equal(config.apps['com.test'].worktrees['old-wt'], undefined);
    });

    it('fails when no app can be detected and no apps configured', () => {
      const { exitCode, stderr } = run(['add', 'feat-x', '--path', '/tmp']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Could not auto-detect'));
    });
  });

  describe('release', () => {
    it('releases existing lock', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      // Manually write a lock
      writeFileSync(
        join(tmpDir, 'lock.json'),
        JSON.stringify({
          ios: { holder: 'test-wt', app: 'com.test', pid: 1, updatedAt: new Date().toISOString() },
        })
      );

      const { exitCode, stdout } = run(['release', '--platform', 'ios']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('released'));
      assert.equal(readLock(), null);
    });

    it('reports no lock held', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      const { exitCode, stdout } = run(['release']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('No lock'));
    });
  });

  describe('status', () => {
    it('reports no lock held', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      const { exitCode, stdout } = run(['status']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('No worktree'));
    });

    it('shows lock holder', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      run(['add', 'feat-a', '--path', '/tmp', '--port', '8082']);
      writeFileSync(
        join(tmpDir, 'lock.json'),
        JSON.stringify({
          ios: { holder: 'feat-a', app: 'com.test', pid: 1, updatedAt: new Date().toISOString() },
        })
      );

      const { exitCode, stdout } = run(['status', '--platform', 'ios']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('feat-a'));
      assert.ok(stdout.includes('8082'));
    });
  });

  describe('list', () => {
    it('shows registered worktrees', () => {
      seedConfig({ 'com.test': { platforms: ['ios'], worktrees: {} } });
      run(['add', 'main', '--path', '/tmp/main', '--port', '8081']);
      run(['add', 'feat-a', '--path', '/tmp/feat-a', '--port', '8082']);

      const { exitCode, stdout } = run(['list']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.test'));
      assert.ok(stdout.includes('main'));
      assert.ok(stdout.includes('feat-a'));
      assert.ok(stdout.includes('8081'));
      assert.ok(stdout.includes('8082'));
    });

    it('shows empty message when no apps configured', () => {
      const { exitCode, stdout } = run(['list']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('No apps configured'));
    });
  });

  describe('switch', () => {
    it('shows error when no apps configured', () => {
      const { exitCode, stderr } = run(['switch', 'feat-x']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('No apps configured'));
    });
  });

  describe('full flow', () => {
    it('add (auto-detect) → add more → list → status → release', () => {
      writeAppJson(tmpDir, {
        ios: { bundleIdentifier: 'com.flow' },
        android: { package: 'com.flow' },
      });

      // Add worktrees (first add auto-creates app)
      let result = run(['add', 'main', '--path', '/tmp/main', '--port', '8081'], { cwd: tmpDir });
      assert.equal(result.exitCode, 0);

      result = run(['add', 'feature', '--path', '/tmp/feature', '--port', '8082']);
      assert.equal(result.exitCode, 0);

      const config = readConfig();
      assert.ok(config.apps['com.flow']);
      assert.equal(config.apps['com.flow'].worktrees['feature'].port, 8082);

      // List shows both
      result = run(['list']);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('main'));
      assert.ok(result.stdout.includes('feature'));

      // Manually set lock (switch would try xcrun/adb)
      writeFileSync(
        join(tmpDir, 'lock.json'),
        JSON.stringify({
          ios: { holder: 'feature', app: 'com.flow', pid: 1, updatedAt: new Date().toISOString() },
        })
      );

      // Status shows holder
      result = run(['status', '--platform', 'ios']);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('feature'));

      // Release
      result = run(['release', '--platform', 'ios']);
      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('released'));

      // Status shows free
      result = run(['status', '--platform', 'ios']);
      assert.ok(result.stdout.includes('No worktree'));
    });
  });
});
