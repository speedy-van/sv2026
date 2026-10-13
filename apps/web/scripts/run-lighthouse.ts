import process from 'node:process';

import { localServerUrl, npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

const targets = [
  { path: '/', reportPath: '.lighthouse-home.json' },
  { path: '/services/house-removals', reportPath: '.lighthouse-service.json' },
] as const;

const exitCode = await withNextServer(async () => {
  for (const target of targets) {
    const lighthouseCode = await runCommand(npxExecutable, [
      'lighthouse',
      `${localServerUrl}${target.path}`,
      '--only-categories=performance,accessibility,best-practices,seo',
      '--chrome-flags=--headless=new --no-sandbox',
      '--output=json',
      `--output-path=${target.reportPath}`,
      '--quiet',
    ]);

    if (lighthouseCode !== 0) {
      return lighthouseCode;
    }
  }

  return runCommand(npxExecutable, ['tsx', 'scripts/check-lighthouse.ts']);
});

process.exitCode = exitCode;
