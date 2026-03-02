import { release } from '../lock.js';
import chalk from 'chalk';

export default function releaseCommand(program) {
  program
    .command('release')
    .description('Release the mutex lock for a platform')
    .option('--platform <platform>', 'Target platform (ios or android)', 'ios')
    .action((opts) => {
      const platform = opts.platform;
      const released = release(platform);
      if (released) {
        console.log(chalk.green(`[${platform}] Lock released. Runtime is available.`));
      } else {
        console.log(chalk.dim(`[${platform}] No lock was held.`));
      }
    });
}
