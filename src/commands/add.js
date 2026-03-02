import { addWorktree, loadConfig } from '../config.js';
import chalk from 'chalk';
import { resolve } from 'path';

export default function addCommand(program) {
  program
    .command('add <name>')
    .description('Register a worktree with a port mapping')
    .option('--path <path>', 'Path to the worktree', process.cwd())
    .option('--port <port>', 'Metro port number')
    .action((name, opts) => {
      const config = loadConfig();
      if (!config) {
        console.error(chalk.red('Not initialized. Run `react-native-worktree init` first.'));
        process.exit(1);
      }

      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const absPath = resolve(opts.path);
      const wt = addWorktree(name, absPath, port);

      console.log(chalk.green(`Added '${chalk.bold(name)}' on port ${wt.port}`));
      console.log(chalk.dim(`Start Metro: cd ${absPath} && npx expo start --port ${wt.port}`));
    });
}
