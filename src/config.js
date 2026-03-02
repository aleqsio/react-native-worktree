import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

export function getApp(config, bundleId) {
  return config.apps?.[bundleId] || null;
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
    throw new Error('Not initialized. Run `react-native-worktree init` first.');
  }
  const app = config.apps[bundleId];
  if (!app) {
    throw new Error(`App '${bundleId}' not found. Run \`react-native-worktree init --bundle-id ${bundleId}\` first.`);
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

