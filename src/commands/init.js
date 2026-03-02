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
    .option('--platforms <list>', 'Target platforms, comma-separated (ios,android)')
    .option('--android-package <pkg>', 'Android package name (auto-detected if omitted)')
    .action((opts) => {
      let platforms;
      if (opts.platforms) {
        const parsed = parsePlatforms(opts.platforms);
        if (parsed.error) {
          console.error(chalk.red(parsed.error));
          process.exit(1);
        }
        platforms = parsed.platforms;
      }

      // Detect both platform IDs from app.json
      const iosId = detectBundleId('ios');
      const androidId = detectBundleId('android');

      // Auto-detect platforms when --platforms not provided
      if (!platforms) {
        if (iosId && androidId) {
          platforms = ['ios', 'android'];
        } else if (iosId) {
          platforms = ['ios'];
        } else if (androidId) {
          platforms = ['android'];
        } else {
          platforms = ['ios']; // fallback default
        }
      }

      // Resolve bundleId: explicit flag > iOS detection > Android detection
      let bundleId = opts.bundleId;
      if (!bundleId) {
        bundleId = iosId || androidId;
        if (bundleId) {
          console.log(chalk.dim(`Auto-detected bundle ID: ${bundleId}`));
        } else {
          console.error(chalk.red('Could not auto-detect bundle ID. Use --bundle-id <id>.'));
          process.exit(1);
        }
      }

      // Resolve Android package: explicit flag > detection
      let androidPackage = opts.androidPackage || androidId || null;
      if (androidPackage) {
        if (androidPackage !== bundleId) {
          console.log(chalk.dim(`Auto-detected Android package: ${androidPackage}`));
        } else {
          androidPackage = null; // omit when it matches the primary key
        }
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
