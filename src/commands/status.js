import { getStatus } from '../lock.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';

export default function statusCommand(program) {
  program
    .command('status')
    .description('Show current lock holder and active worktree')
    .option('--platform <platform>', 'Filter by platform (ios or android)')
    .action((opts) => {
      const config = loadConfig();

      if (opts.platform) {
        const lock = getStatus(opts.platform);
        if (!lock.held) {
          console.log(chalk.dim(`[${opts.platform}] No worktree holds the runtime.`));
          return;
        }
        const port = findPort(config, lock.holder, lock.app);
        const elapsed = Math.round(lock.elapsedMs / 1000);
        const portStr = port ? ` (port ${port})` : '';
        console.log(`[${opts.platform}] Runtime held by '${chalk.bold(lock.holder)}'${portStr}, last active ${elapsed}s ago`);
        return;
      }

      // Show all platforms
      const allStatus = getStatus();
      const platforms = Object.keys(allStatus);

      if (platforms.length === 0) {
        console.log(chalk.dim('No worktree holds the runtime on any platform.'));
        return;
      }

      for (const plat of platforms) {
        const lock = allStatus[plat];
        const port = findPort(config, lock.holder, lock.app);
        const elapsed = Math.round(lock.elapsedMs / 1000);
        const portStr = port ? ` (port ${port})` : '';
        console.log(`[${plat}] Runtime held by '${chalk.bold(lock.holder)}'${portStr}, last active ${elapsed}s ago`);
      }
    });
}

function findPort(config, holder, appId) {
  if (!config?.apps) return null;
  if (appId && config.apps[appId]?.worktrees?.[holder]) {
    return config.apps[appId].worktrees[holder].port;
  }
  // Fallback: search all apps
  for (const app of Object.values(config.apps)) {
    if (app.worktrees?.[holder]) return app.worktrees[holder].port;
  }
  return null;
}
