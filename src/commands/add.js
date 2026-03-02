import { addWorktree, loadConfig, resolveApp, getAllPorts, computeNextPort } from '../config.js';
import { isMetroRunning } from '../switcher.js';
import chalk from 'chalk';
import { resolve } from 'path';

async function findReusablePort(config) {
  const ports = getAllPorts(config);
  if (ports.length === 0) return null;

  // Build port→worktree name map for logging
  const portOwners = {};
  for (const [appId, app] of Object.entries(config.apps || {})) {
    for (const [name, wt] of Object.entries(app.worktrees || {})) {
      portOwners[wt.port] = { name, app: appId };
    }
  }

  // Probe each port
  const results = await Promise.all(
    ports.map(async (port) => ({
      port,
      alive: await isMetroRunning(port),
      owner: portOwners[port],
    }))
  );

  // Find first dead port
  const dead = results.find(r => !r.alive);
  return dead || null;
}

export default function addCommand(program) {
  program
    .command('add <name>')
    .description('Register a worktree with a port mapping')
    .option('--path <path>', 'Path to the worktree', process.cwd())
    .option('--port <port>', 'Metro port number')
    .option('--app <bundleId>', 'App bundle identifier (auto-detected if one app)')
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

      let port = opts.port ? parseInt(opts.port, 10) : undefined;

      if (!port) {
        // Try port reclamation
        const dead = await findReusablePort(config);
        if (dead) {
          port = dead.port;
          console.log(chalk.dim(`Reusing port ${port} (Metro stopped for '${dead.owner.name}')`));
        } else {
          port = computeNextPort(config);
        }
      }

      const absPath = resolve(opts.path);
      const wt = addWorktree(bundleId, name, absPath, port);

      console.log(chalk.green(`Added '${chalk.bold(name)}' on port ${wt.port} (app: ${bundleId})`));
      console.log(chalk.dim(`Start Metro: cd ${absPath} && npx expo start --port ${wt.port}`));
    });
}
