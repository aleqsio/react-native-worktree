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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rnwt-cli-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('CLI', () => {
  describe('init', () => {
    it('initializes with explicit bundle id', () => {
      const { stdout, exitCode } = run(['init', '--bundle-id', 'com.test.app']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.test.app'));

      const config = readConfig();
      assert.ok(config.apps['com.test.app']);
      assert.deepEqual(config.apps['com.test.app'].platforms, ['ios']);
    });

    it('initializes with multiple platforms', () => {
      const { exitCode } = run(['init', '--bundle-id', 'com.test', '--platforms', 'ios,android']);
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.deepEqual(config.apps['com.test'].platforms, ['ios', 'android']);
    });

    it('rejects invalid platform', () => {
      const { exitCode, stderr } = run(['init', '--bundle-id', 'com.test', '--platforms', 'windows']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Invalid platform'));
    });

    it('auto-detects bundle ID from app.json (ios only)', () => {
      writeFileSync(
        join(tmpDir, 'app.json'),
        JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.detected' } } })
      );
      const { exitCode, stdout } = run(['init'], { cwd: tmpDir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.detected'));

      const config = readConfig();
      assert.deepEqual(config.apps['com.detected'].platforms, ['ios']);
    });

    it('auto-detects bundle ID from app.json (android only)', () => {
      writeFileSync(
        join(tmpDir, 'app.json'),
        JSON.stringify({ expo: { android: { package: 'com.detected.android' } } })
      );
      const { exitCode, stdout } = run(['init'], { cwd: tmpDir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.detected.android'));

      const config = readConfig();
      assert.deepEqual(config.apps['com.detected.android'].platforms, ['android']);
    });

    it('auto-detects both platforms when both defined in app.json', () => {
      writeFileSync(
        join(tmpDir, 'app.json'),
        JSON.stringify({
          expo: {
            ios: { bundleIdentifier: 'com.test.my-app' },
            android: { package: 'com.test.myapp' },
          },
        })
      );
      const { exitCode, stdout } = run(['init'], { cwd: tmpDir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.test.my-app'));

      const config = readConfig();
      assert.deepEqual(config.apps['com.test.my-app'].platforms, ['ios', 'android']);
      assert.equal(config.apps['com.test.my-app'].androidPackage, 'com.test.myapp');
    });

    it('fails when no bundle ID can be detected', () => {
      const { exitCode, stderr } = run(['init']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Could not auto-detect'));
    });

    it('detects differing android package from app.json', () => {
      writeFileSync(
        join(tmpDir, 'app.json'),
        JSON.stringify({
          expo: {
            ios: { bundleIdentifier: 'com.test.my-app' },
            android: { package: 'com.test.myapp' },
          },
        })
      );
      const { exitCode, stdout } = run(['init', '--platforms', 'ios,android'], { cwd: tmpDir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('com.test.my-app'));

      const config = readConfig();
      assert.equal(config.apps['com.test.my-app'].androidPackage, 'com.test.myapp');
    });

    it('omits androidPackage when it matches bundleId', () => {
      writeFileSync(
        join(tmpDir, 'app.json'),
        JSON.stringify({
          expo: {
            ios: { bundleIdentifier: 'com.test.app' },
            android: { package: 'com.test.app' },
          },
        })
      );
      const { exitCode } = run(['init', '--platforms', 'ios,android'], { cwd: tmpDir });
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.equal(config.apps['com.test.app'].androidPackage, undefined);
    });

    it('stores --android-package override', () => {
      const { exitCode } = run([
        'init', '--bundle-id', 'com.test.my-app',
        '--platforms', 'ios,android',
        '--android-package', 'com.test.custom',
      ]);
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.equal(config.apps['com.test.my-app'].androidPackage, 'com.test.custom');
    });
  });

  describe('add', () => {
    it('adds a worktree with explicit port', () => {
      run(['init', '--bundle-id', 'com.test']);
      const { exitCode, stdout } = run(['add', 'feat-a', '--path', '/tmp/feat-a', '--port', '9001']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('feat-a'));
      assert.ok(stdout.includes('9001'));

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['feat-a'].port, 9001);
    });

    it('auto-assigns port', () => {
      run(['init', '--bundle-id', 'com.test']);
      const { exitCode } = run(['add', 'feat-b', '--path', '/tmp/feat-b']);
      assert.equal(exitCode, 0);

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['feat-b'].port, 8082);
    });

    it('registers multiple worktrees with explicit ports', () => {
      run(['init', '--bundle-id', 'com.test']);
      run(['add', 'w1', '--path', '/tmp/w1', '--port', '8081']);
      run(['add', 'w2', '--path', '/tmp/w2', '--port', '8082']);

      const config = readConfig();
      assert.equal(config.apps['com.test'].worktrees['w1'].port, 8081);
      assert.equal(config.apps['com.test'].worktrees['w2'].port, 8082);
    });

    it('fails without init', () => {
      const { exitCode, stderr } = run(['add', 'feat-x', '--path', '/tmp']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Not initialized'));
    });
  });

  describe('release', () => {
    it('releases existing lock', () => {
      run(['init', '--bundle-id', 'com.test']);
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
      run(['init', '--bundle-id', 'com.test']);
      const { exitCode, stdout } = run(['release']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('No lock'));
    });
  });

  describe('status', () => {
    it('reports no lock held', () => {
      run(['init', '--bundle-id', 'com.test']);
      const { exitCode, stdout } = run(['status']);
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('No worktree'));
    });

    it('shows lock holder', () => {
      run(['init', '--bundle-id', 'com.test']);
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
      run(['init', '--bundle-id', 'com.test']);
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

    it('fails without init', () => {
      const { exitCode, stderr } = run(['list']);
      assert.notEqual(exitCode, 0);
      assert.ok(stderr.includes('Not initialized'));
    });
  });

  describe('full flow', () => {
    it('init → add → list → status → release', () => {
      // Init
      let result = run(['init', '--bundle-id', 'com.flow', '--platforms', 'ios,android']);
      assert.equal(result.exitCode, 0);

      // Add worktrees
      run(['add', 'main', '--path', '/tmp/main', '--port', '8081']);
      run(['add', 'feature', '--path', '/tmp/feature', '--port', '8082']);
      const config = readConfig();
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
