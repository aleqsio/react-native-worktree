import { getStatus } from '../lock.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';

export default function statusCommand(program) {
  program
    .command('status')
    .description('Show current lock holder and active worktree')
    .action(() => {
      const config = loadConfig();
      const lock = getStatus();

      if (!lock.held) {
        console.log(chalk.dim('No worktree holds the runtime.'));
        return;
      }

      const port = config?.worktrees?.[lock.holder]?.port;
      const elapsed = Math.round(lock.elapsedMs / 1000);
      const portStr = port ? ` (port ${port})` : '';
      console.log(`Runtime held by '${chalk.bold(lock.holder)}'${portStr}, last active ${elapsed}s ago`);
    });
}
