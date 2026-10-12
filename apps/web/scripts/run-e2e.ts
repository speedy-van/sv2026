import process from 'node:process';

import { npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

const defaultGrep = '@foundation';

const normalizePlaywrightArgs = (rawArgs: readonly string[]): string[] => {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : [...rawArgs];

  if (args.length === 0) {
    return ['--grep', defaultGrep];
  }

  const grepIndex = args.indexOf('--grep');
  if (grepIndex >= 0) {
    const grepValue = args[grepIndex + 1];
    if (grepValue === undefined || grepValue.startsWith('--')) {
      const normalized = [...args];
      normalized.splice(grepIndex + 1, 0, defaultGrep);
      return normalized;
    }
  }

  return args;
};

const exitCode = await withNextServer(async () =>
  runCommand(npxExecutable, ['playwright', 'test', ...normalizePlaywrightArgs(process.argv.slice(2))]),
);

process.exitCode = exitCode;
