import { loadConfig, getWorktree, resolveApp, getApp, getPackageName } from '../config.js';
import { waitForLock } from '../lock.js';
import { switchPort, isMetroRunning } from '../switcher.js';
import chalk from 'chalk';

export default function switchCommand(program) {
  program
    .command('switch <name>')
    .description('Acquire lock and switch the app to a worktree\'s Metro server')
    .option('--timeout <ms>', 'Inactivity timeout — how long before a held lock is considered stale (ms)', '60000')
    .option('--app <bundleId>', 'App bundle identifier (auto-detected if one app)')
    .option('--platform <platform>', 'Target platform (ios or android)')
    .action(async (name, opts) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('Not initialized. Run `react-native-worktree init` first.'));
        process.exit(1);
      }

      const bundleId = resolveApp(config, opts.app);
      if (!bundleId) {
        if (opts.app) {
          console.error(chalk.red(`App '${opts.app}' not found in config.`));
        } else {
          console.error(chalk.red('Multiple apps configured. Use --app <bundleId> to specify which one.'));
        }
        process.exit(1);
      }

      const app = getApp(config, bundleId);
      const platform = opts.platform || app.platforms[0];
      if (!app.platforms.includes(platform)) {
        console.error(chalk.red(`Platform '${platform}' not configured for ${bundleId}. Available: ${app.platforms.join(', ')}`));
        process.exit(1);
      }

      const wt = getWorktree(bundleId, name);
      if (!wt) {
        console.error(chalk.red(`Worktree '${name}' not found. Run \`react-native-worktree add ${name}\` first.`));
        process.exit(1);
      }

      const timeoutMs = parseInt(opts.timeout, 10);
      const result = await waitForLock(name, bundleId, platform, timeoutMs);

      if (!result.switched) {
        console.log(chalk.dim(`[${platform}] Lock refreshed for '${name}'`));
        return;
      }

      if (result.previousHolder) {
        console.log(chalk.yellow(`[${platform}] Took over from stale holder '${result.previousHolder}'`));
      }

      // Check if Metro is running
      const running = await isMetroRunning(wt.port);
      if (!running) {
        console.log(chalk.yellow(`Warning: Metro not detected on port ${wt.port}`));
        console.log(chalk.dim(`Start it: cd ${wt.path} && npx expo start --port ${wt.port}`));
      }

      // Switch port and relaunch app
      const packageName = getPackageName(app, bundleId, platform);
      try {
        switchPort(packageName, wt.port, platform);
        console.log(chalk.green(`[${platform}] Switched to '${chalk.bold(name)}' (port ${wt.port}). App restarting...`));
      } catch (err) {
        console.error(chalk.red(`Failed to switch: ${err.message}`));
        process.exit(1);
      }
    });
}
