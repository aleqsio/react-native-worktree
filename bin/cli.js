#!/usr/bin/env node

import { Command } from 'commander';
import initCommand from '../src/commands/init.js';
import addCommand from '../src/commands/add.js';
import switchCommand from '../src/commands/switch.js';
import releaseCommand from '../src/commands/release.js';
import statusCommand from '../src/commands/status.js';
import listCommand from '../src/commands/list.js';

const program = new Command();

program
  .name('rnwt')
  .description('Metro port switcher with mutex for multi-agent RN development')
  .version('1.0.0');

initCommand(program);
addCommand(program);
switchCommand(program);
releaseCommand(program);
statusCommand(program);
listCommand(program);

program.parse();
