import process from 'node:process';

import { npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

process.env.E2E ??= '1';
process.env.MAPBOX_MODE ??= 'mock';
process.env.CUSTOMER_LINK_SECRET ??= 'local-e2e-customer-link-secret';
process.env.IP_HASH_SALT ??= 'local-e2e-ip-hash-salt';

const normalizePlaywrightArgs = (rawArgs: readonly string[]): string[] => {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : [...rawArgs];
  return args;
};

const runPlaywright = async (): Promise<number> =>
  runCommand(npxExecutable, ['playwright', 'test', ...normalizePlaywrightArgs(process.argv.slice(2))]);

const exitCode = process.env.E2E_BASE_URL ? await runPlaywright() : await withNextServer(runPlaywright);

process.exitCode = exitCode;
