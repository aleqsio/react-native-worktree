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

function parsePlatforms(input) {
  const platforms = input.split(',').map(p => p.trim()).filter(Boolean);
  for (const p of platforms) {
    if (p !== 'ios' && p !== 'android') {
      return { error: `Invalid platform: ${p}. Must be 'ios' or 'android'.` };
    }
  }
  if (platforms.length === 0) {
    return { error: 'At least one platform is required.' };
  }
  return { platforms: [...new Set(platforms)] };
}

export default function initCommand(program) {
  program
    .command('init')
    .description('Initialize config with bundle ID and platforms')
    .option('--bundle-id <id>', 'App bundle identifier')
    .option('--platforms <list>', 'Target platforms, comma-separated (ios,android)', 'ios')
    .option('--android-package <pkg>', 'Android package name (auto-detected if omitted)')
    .action((opts) => {
      const { platforms, error } = parsePlatforms(opts.platforms);
      if (error) {
        console.error(chalk.red(error));
        process.exit(1);
      }

      let bundleId = opts.bundleId;
      if (!bundleId) {
        // Try detecting with first platform
        bundleId = detectBundleId(platforms[0]);
        if (bundleId) {
          console.log(chalk.dim(`Auto-detected bundle ID: ${bundleId}`));
        } else {
          console.error(chalk.red('Could not auto-detect bundle ID. Use --bundle-id <id>.'));
          process.exit(1);
        }
      }

      // Determine Android package name
      let androidPackage = opts.androidPackage || null;
      if (!androidPackage && platforms.includes('android') && platforms[0] !== 'android') {
        // Primary bundleId came from a non-android platform; detect the android package separately
        androidPackage = detectBundleId('android');
        if (androidPackage) {
          console.log(chalk.dim(`Auto-detected Android package: ${androidPackage}`));
        }
      }
      // Only store androidPackage when it differs from the primary key
      if (androidPackage === bundleId) {
        androidPackage = null;
      }

      const appEntry = { platforms, worktrees: {} };
      if (androidPackage) {
        appEntry.androidPackage = androidPackage;
      }

      const existing = loadConfig();
      if (existing && existing.apps) {
        // Add or update app entry
        const prev = existing.apps[bundleId] || { platforms: [], worktrees: {} };
        prev.platforms = platforms;
        if (androidPackage) {
          prev.androidPackage = androidPackage;
        } else {
          delete prev.androidPackage;
        }
        existing.apps[bundleId] = prev;
        saveConfig(existing);
      } else {
        saveConfig({
          apps: {
            [bundleId]: appEntry,
          },
        });
      }

      console.log(chalk.green(`Initialized react-native-worktree for ${chalk.bold(bundleId)} (${platforms.join(', ')})`));
    });
}
