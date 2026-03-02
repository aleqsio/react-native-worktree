import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { saveConfig, loadConfig } from '../config.js';
import chalk from 'chalk';

function detectBundleId(platform) {
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

export default function initCommand(program) {
  program
    .command('init')
    .description('Initialize config with bundle ID and platform')
    .option('--bundle-id <id>', 'App bundle identifier')
    .option('--platform <platform>', 'Target platform (ios or android)', 'ios')
    .action((opts) => {
      const platform = opts.platform;
      if (platform !== 'ios' && platform !== 'android') {
        console.error(chalk.red(`Invalid platform: ${platform}. Must be 'ios' or 'android'.`));
        process.exit(1);
      }

      let bundleId = opts.bundleId;
      if (!bundleId) {
        bundleId = detectBundleId(platform);
        if (bundleId) {
          console.log(chalk.dim(`Auto-detected bundle ID: ${bundleId}`));
        } else {
          console.error(chalk.red('Could not auto-detect bundle ID. Use --bundle-id <id>.'));
          process.exit(1);
        }
      }

      const existing = loadConfig();
      if (existing) {
        existing.bundleId = bundleId;
        existing.platform = platform;
        saveConfig(existing);
      } else {
        saveConfig({
          bundleId,
          platform,
          worktrees: {},
          nextPort: 8082,
        });
      }

      console.log(chalk.green(`Initialized worktree-rn for ${chalk.bold(bundleId)} (${platform})`));
    });
}
