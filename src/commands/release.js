import { release } from '../lock.js';
import chalk from 'chalk';

export default function releaseCommand(program) {
  program
    .command('release')
    .description('Release the mutex lock')
    .action(() => {
      const released = release();
      if (released) {
        console.log(chalk.green('Lock released. Runtime is available.'));
      } else {
        console.log(chalk.dim('No lock was held.'));
      }
    });
}
