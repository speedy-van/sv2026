import process from 'node:process';

import { localServerUrl, npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

const reportPath = '.lighthouse-home.json';

const exitCode = await withNextServer(async () => {
  const lighthouseCode = await runCommand(npxExecutable, [
    'lighthouse',
    localServerUrl,
    '--only-categories=performance',
    '--chrome-flags=--headless=new --no-sandbox',
    '--output=json',
    `--output-path=${reportPath}`,
    '--quiet',
  ]);

  if (lighthouseCode !== 0) {
    return lighthouseCode;
  }

  return runCommand(npxExecutable, ['tsx', 'scripts/check-lighthouse.ts']);
});

process.exitCode = exitCode;
