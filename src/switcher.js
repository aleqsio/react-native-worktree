import { execSync } from 'child_process';
import { request } from 'http';

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function runQuiet(cmd) {
  try {
    return run(cmd);
  } catch {
    return null;
  }
}

export function switchPort(bundleId, port, platform) {
  if (platform === 'ios') {
    switchIOS(bundleId, port);
  } else if (platform === 'android') {
    switchAndroid(bundleId, port);
  } else {
    throw new Error(`Unknown platform: ${platform}`);
  }
}

function switchIOS(bundleId, port) {
  run(`xcrun simctl spawn booted defaults write ${bundleId} RCT_jsLocation "localhost:${port}"`);
  runQuiet(`xcrun simctl terminate booted ${bundleId}`);
  run(`xcrun simctl launch booted ${bundleId}`);
}

function switchAndroid(packageName, port) {
  // Write debug_http_host to default SharedPreferences (<package>_preferences.xml)
  const prefsFile = `/data/data/${packageName}/shared_prefs/${packageName}_preferences.xml`;
  const xml = `<?xml version=\\"1.0\\" encoding=\\"utf-8\\"?><map><string name=\\"debug_http_host\\">localhost:${port}</string></map>`;
  run(`adb shell "echo '${xml}' | run-as ${packageName} sh -c 'cat > ${prefsFile}'"`);
  run(`adb reverse tcp:${port} tcp:${port}`);
  runQuiet(`adb shell am force-stop ${packageName}`);
  run(`adb shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
}

export function isMetroRunning(port) {
  return new Promise((resolve) => {
    const req = request(
      { hostname: 'localhost', port, path: '/status', timeout: 2000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data.includes('packager-status:running')));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
