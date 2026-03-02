import { addWorktree, ensureConfig, ensureApp, saveConfig, getAllPorts, computeNextPort } from '../config.js';
import { isMetroRunning } from '../switcher.js';
import chalk from 'chalk';
import { resolve } from 'path';

async function findReusablePort(config, excludeName) {
  const ports = [];
  const portOwners = {};
  for (const [appId, app] of Object.entries(config.apps || {})) {
    for (const [name, wt] of Object.entries(app.worktrees || {})) {
      // Skip the worktree being (re-)added — don't reclaim our own port
      if (name === excludeName) continue;
      if (wt.port) {
        ports.push(wt.port);
        portOwners[wt.port] = { name, app: appId };
      }
    }
  }
  if (ports.length === 0) return null;

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

function removeWorktreeEntry(config, appId, name) {
  const app = config.apps[appId];
  if (app?.worktrees?.[name]) {
    delete app.worktrees[name];
    saveConfig(config);
  }
}

export default function addCommand(program) {
  program
    .command('add <name>')
    .description('Register a worktree with a port mapping')
    .option('--path <path>', 'Path to the worktree', process.cwd())
    .option('--port <port>', 'Metro port number')
    .option('--app <bundleId>', 'App bundle identifier (auto-detected if one app)')
    .action(async (name, opts) => {
      const config = ensureConfig();

      const { config: updatedConfig, bundleId } = ensureApp(config, opts.app);
      if (!bundleId) {
        if (opts.app) {
          console.error(chalk.red(`App '${opts.app}' not found in config.`));
        } else if (Object.keys(updatedConfig.apps).length > 1) {
          console.error(chalk.red('Multiple apps configured. Use --app <bundleId> to specify which one.'));
        } else {
          console.error(chalk.red('Could not auto-detect bundle ID. Use --app <bundleId> or run from a directory with app.json.'));
        }
        process.exit(1);
      }

      let port = opts.port ? parseInt(opts.port, 10) : undefined;

      if (!port) {
        // Try port reclamation (excludes the worktree being added to avoid self-reclaim)
        const dead = await findReusablePort(updatedConfig, name);
        if (dead) {
          port = dead.port;
          // Remove the old worktree entry that owned this port
          removeWorktreeEntry(updatedConfig, dead.owner.app, dead.owner.name);
          console.log(chalk.dim(`Reusing port ${port} (removed stale worktree '${dead.owner.name}')`));
        } else {
          port = computeNextPort(updatedConfig);
        }
      }

      const absPath = resolve(opts.path);
      const wt = addWorktree(bundleId, name, absPath, port);

      console.log(chalk.green(`Added '${chalk.bold(name)}' on port ${wt.port} (app: ${bundleId})`));
      console.log(chalk.dim(`Start Metro: cd ${absPath} && npx expo start --port ${wt.port}`));
    });
}
