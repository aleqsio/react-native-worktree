import { loadConfig, getWorktree } from '../config.js';
import { waitForLock } from '../lock.js';
import { switchPort, isMetroRunning } from '../switcher.js';
import chalk from 'chalk';

export default function switchCommand(program) {
  program
    .command('switch <name>')
    .description('Acquire lock and switch the app to a worktree\'s Metro server')
    .option('--timeout <ms>', 'Inactivity timeout — how long before a held lock is considered stale (ms)', '60000')
    .action(async (name, opts) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('Not initialized. Run `react-native-worktree init` first.'));
        process.exit(1);
      }

      const wt = getWorktree(name);
      if (!wt) {
        console.error(chalk.red(`Worktree '${name}' not found. Run \`react-native-worktree add ${name}\` first.`));
        process.exit(1);
      }

      const timeoutMs = parseInt(opts.timeout, 10);
      const result = await waitForLock(name, timeoutMs);

      if (!result.switched) {
        // Heartbeat — same worktree already holds lock
        console.log(chalk.dim(`Lock refreshed for '${name}'`));
        return;
      }

      if (result.previousHolder) {
        console.log(chalk.yellow(`Took over from stale holder '${result.previousHolder}'`));
      }

      // Check if Metro is running
      const running = await isMetroRunning(wt.port);
      if (!running) {
        console.log(chalk.yellow(`Warning: Metro not detected on port ${wt.port}`));
        console.log(chalk.dim(`Start it: cd ${wt.path} && npx expo start --port ${wt.port}`));
      }

      // Switch port and relaunch app
      try {
        switchPort(config.bundleId, wt.port, config.platform);
        console.log(chalk.green(`Switched to '${chalk.bold(name)}' (port ${wt.port}). App restarting...`));
      } catch (err) {
        console.error(chalk.red(`Failed to switch: ${err.message}`));
        process.exit(1);
      }
    });
}
