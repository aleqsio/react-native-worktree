import { ensureConfig } from '../config.js';
import { getStatus } from '../lock.js';
import { isMetroRunning } from '../switcher.js';
import chalk from 'chalk';

export default function listCommand(program) {
  program
    .command('list')
    .description('List all registered worktrees with Metro status')
    .option('--app <bundleId>', 'Filter by app bundle identifier')
    .action(async (opts) => {
      const config = ensureConfig();

      if (Object.keys(config.apps).length === 0) {
        console.log(chalk.dim('No apps configured. Run `react-native-worktree add <name>` to get started.'));
        return;
      }

      const allLocks = getStatus();

      // Build list of apps to show
      const appIds = opts.app ? [opts.app] : Object.keys(config.apps);

      for (const appId of appIds) {
        const app = config.apps[appId];
        if (!app) {
          console.error(chalk.red(`App '${appId}' not found.`));
          continue;
        }

        const worktrees = app.worktrees || {};
        const names = Object.keys(worktrees);

        console.log(chalk.bold(`\n${appId}`) + chalk.dim(` (${app.platforms.join(', ')})`));

        if (names.length === 0) {
          console.log(chalk.dim('  No worktrees registered.'));
          continue;
        }

        // Check Metro status for all ports in parallel
        const statuses = await Promise.all(
          names.map(name => isMetroRunning(worktrees[name].port))
        );

        // Collect lock info for this app's worktrees
        const lockHolders = new Set();
        for (const [, entry] of Object.entries(allLocks)) {
          if (entry.app === appId) lockHolders.add(entry.holder);
        }
        // Build platform lock details
        const lockDetails = {};
        for (const [plat, entry] of Object.entries(allLocks)) {
          if (entry.app === appId && entry.holder) {
            if (!lockDetails[entry.holder]) lockDetails[entry.holder] = [];
            lockDetails[entry.holder].push(plat);
          }
        }

        // Print table header
        console.log(
          '  ' +
          chalk.bold('Name'.padEnd(20)) +
          chalk.bold('Port'.padEnd(8)) +
          chalk.bold('Metro'.padEnd(10)) +
          chalk.bold('Lock')
        );
        console.log('  ' + '-'.repeat(55));

        names.forEach((name, i) => {
          const wt = worktrees[name];
          const metro = statuses[i] ? chalk.green('running') : chalk.dim('stopped');
          const platforms = lockDetails[name];
          const lockStr = platforms ? chalk.yellow(platforms.join(',')) : '';

          console.log(
            '  ' +
            name.padEnd(20) +
            String(wt.port).padEnd(8) +
            metro.padEnd(19) + // extra for ANSI codes
            lockStr
          );
        });
      }

      console.log('');
    });
}
