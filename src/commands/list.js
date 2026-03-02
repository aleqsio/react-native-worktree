import { loadConfig } from '../config.js';
import { getStatus } from '../lock.js';
import { isMetroRunning } from '../switcher.js';
import chalk from 'chalk';

export default function listCommand(program) {
  program
    .command('list')
    .description('List all registered worktrees with Metro status')
    .action(async () => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('Not initialized. Run `worktree-rn init` first.'));
        process.exit(1);
      }

      const worktrees = config.worktrees || {};
      const names = Object.keys(worktrees);

      if (names.length === 0) {
        console.log(chalk.dim('No worktrees registered. Run `worktree-rn add <name>` to add one.'));
        return;
      }

      const lock = getStatus();

      // Check Metro status for all ports in parallel
      const statuses = await Promise.all(
        names.map(name => isMetroRunning(worktrees[name].port))
      );

      // Print table header
      console.log(
        chalk.bold('Name'.padEnd(20)) +
        chalk.bold('Port'.padEnd(8)) +
        chalk.bold('Metro'.padEnd(10)) +
        chalk.bold('Lock')
      );
      console.log('-'.repeat(50));

      names.forEach((name, i) => {
        const wt = worktrees[name];
        const metro = statuses[i] ? chalk.green('running') : chalk.dim('stopped');
        const isHolder = lock.held && lock.holder === name;
        const lockStr = isHolder ? chalk.yellow('held') : '';

        console.log(
          name.padEnd(20) +
          String(wt.port).padEnd(8) +
          metro.padEnd(19) + // extra for ANSI codes
          lockStr
        );
      });
    });
}
