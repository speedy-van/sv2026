import process from 'node:process';

import { npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

const defaultGrep = '@foundation';

process.env.E2E ??= '1';
process.env.MAPBOX_MODE ??= 'mock';
process.env.CUSTOMER_LINK_SECRET ??= 'local-e2e-customer-link-secret';
process.env.IP_HASH_SALT ??= 'local-e2e-ip-hash-salt';

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
