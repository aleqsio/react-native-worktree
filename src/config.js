import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.rnwt');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) {
    return null;
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function saveConfig(config) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export function addWorktree(name, path, port) {
  const config = loadConfig();
  if (!config) {
    throw new Error('Not initialized. Run `rnwt init` first.');
  }
  if (!port) {
    port = config.nextPort || 8082;
  }
  config.worktrees = config.worktrees || {};
  config.worktrees[name] = { path, port };
  if (port >= (config.nextPort || 8082)) {
    config.nextPort = port + 1;
  }
  saveConfig(config);
  return config.worktrees[name];
}

export function getWorktree(name) {
  const config = loadConfig();
  if (!config || !config.worktrees || !config.worktrees[name]) {
    return null;
  }
  return config.worktrees[name];
}

export { CONFIG_DIR };
