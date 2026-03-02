import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

export function getConfigDir() {
  return process.env.RNWT_HOME || join(homedir(), '.rnwt');
}

function getConfigPath() {
  return join(getConfigDir(), 'config.json');
}

function ensureDir() {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig() {
  ensureDir();
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Migrate old format: { bundleId, platform, worktrees, nextPort }
  // → new format: { apps: { [bundleId]: { platforms: [platform], worktrees } } }
  if (config.bundleId) {
    const bundleId = config.bundleId;
    const platform = config.platform || 'ios';
    const worktrees = config.worktrees || {};
    const migrated = {
      apps: {
        [bundleId]: {
          platforms: [platform],
          worktrees,
        },
      },
    };
    saveConfig(migrated);
    return migrated;
  }

  return config;
}

export function saveConfig(config) {
  ensureDir();
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

export function detectBundleId(platform) {
  // Try app.json
  const appJsonPath = join(process.cwd(), 'app.json');
  if (existsSync(appJsonPath)) {
    try {
      const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
      if (platform === 'ios') {
        const id = appJson?.expo?.ios?.bundleIdentifier;
        if (id) return id;
      } else {
        const id = appJson?.expo?.android?.package;
        if (id) return id;
      }
    } catch { /* ignore */ }
  }

  // Try app.config.js (read as text and extract)
  const appConfigPath = join(process.cwd(), 'app.config.js');
  if (existsSync(appConfigPath)) {
    try {
      const content = readFileSync(appConfigPath, 'utf-8');
      const key = platform === 'ios' ? 'bundleIdentifier' : 'package';
      const match = content.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
      if (match) return match[1];
    } catch { /* ignore */ }
  }

  // Try app.config.ts
  const appConfigTsPath = join(process.cwd(), 'app.config.ts');
  if (existsSync(appConfigTsPath)) {
    try {
      const content = readFileSync(appConfigTsPath, 'utf-8');
      const key = platform === 'ios' ? 'bundleIdentifier' : 'package';
      const match = content.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
      if (match) return match[1];
    } catch { /* ignore */ }
  }

  return null;
}

export function ensureConfig() {
  const existing = loadConfig();
  if (existing) return existing;
  const config = { apps: {} };
  saveConfig(config);
  return config;
}

export function ensureApp(config, bundleIdOpt) {
  // If explicit bundleId provided, check if it exists
  if (bundleIdOpt) {
    if (config.apps[bundleIdOpt]) {
      return { config, bundleId: bundleIdOpt };
    }
    return { config, bundleId: null };
  }

  // If apps already exist, resolve from them
  const appIds = Object.keys(config.apps || {});
  if (appIds.length === 1) {
    return { config, bundleId: appIds[0] };
  }
  if (appIds.length > 1) {
    // Try auto-detect from cwd app.json to match existing app
    const iosBundleId = detectBundleId('ios');
    const androidPkg = detectBundleId('android');
    if (iosBundleId && config.apps[iosBundleId]) return { config, bundleId: iosBundleId };
    if (androidPkg && config.apps[androidPkg]) return { config, bundleId: androidPkg };
    return { config, bundleId: null };
  }

  // No apps — auto-detect and create
  const iosId = detectBundleId('ios');
  const androidId = detectBundleId('android');

  let bundleId = iosId || androidId;
  if (!bundleId) return { config, bundleId: null };

  let platforms;
  if (iosId && androidId) {
    platforms = ['ios', 'android'];
  } else if (iosId) {
    platforms = ['ios'];
  } else {
    platforms = ['android'];
  }

  console.log(chalk.dim(`Auto-detected app: ${bundleId} (${platforms.join(', ')})`));

  const appEntry = { platforms, worktrees: {} };
  // Store androidPackage if it differs from the primary bundleId
  if (androidId && androidId !== bundleId) {
    appEntry.androidPackage = androidId;
    console.log(chalk.dim(`Auto-detected Android package: ${androidId}`));
  }


  config.apps[bundleId] = appEntry;
  saveConfig(config);
  return { config, bundleId };
}

export function getApp(config, bundleId) {
  return config.apps?.[bundleId] || null;
}

export function getPackageName(app, bundleId, platform) {
  if (platform === 'android' && app.androidPackage) {
    return app.androidPackage;
  }
  return bundleId;
}

export function resolveApp(config, bundleId) {
  if (!config || !config.apps) {
    return null;
  }

  // Explicit bundleId provided
  if (bundleId) {
    if (!config.apps[bundleId]) {
      return null;
    }
    return bundleId;
  }

  const appIds = Object.keys(config.apps);

  // Single app → use it
  if (appIds.length === 1) {
    return appIds[0];
  }

  // Try auto-detect from cwd app.json
  if (appIds.length > 1) {
    const appJsonPath = join(process.cwd(), 'app.json');
    if (existsSync(appJsonPath)) {
      try {
        const appJson = JSON.parse(readFileSync(appJsonPath, 'utf-8'));
        const iosBundleId = appJson?.expo?.ios?.bundleIdentifier;
        const androidPkg = appJson?.expo?.android?.package;
        if (iosBundleId && config.apps[iosBundleId]) return iosBundleId;
        if (androidPkg && config.apps[androidPkg]) return androidPkg;
      } catch { /* ignore */ }
    }
  }

  return null;
}

export function getAllPorts(config) {
  const ports = [];
  if (!config?.apps) return ports;
  for (const app of Object.values(config.apps)) {
    for (const wt of Object.values(app.worktrees || {})) {
      if (wt.port) ports.push(wt.port);
    }
  }
  return ports;
}

export function computeNextPort(config) {
  const ports = getAllPorts(config);
  if (ports.length === 0) return 8082;
  return Math.max(...ports, 8081) + 1;
}

export function addWorktree(bundleId, name, path, port) {
  const config = loadConfig();
  if (!config || !config.apps) {
    throw new Error('No config found. Run `react-native-worktree add <name>` from your project directory.');
  }
  const app = config.apps[bundleId];
  if (!app) {
    throw new Error(`App '${bundleId}' not found in config.`);
  }
  if (!port) {
    port = computeNextPort(config);
  }
  app.worktrees = app.worktrees || {};
  app.worktrees[name] = { path, port };
  saveConfig(config);
  return app.worktrees[name];
}

export function getWorktree(bundleId, name) {
  const config = loadConfig();
  if (!config?.apps?.[bundleId]?.worktrees?.[name]) {
    return null;
  }
  return config.apps[bundleId].worktrees[name];
}

