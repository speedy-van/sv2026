import process from 'node:process';

import { localServerUrl, npxExecutable, runCommand, withNextServer } from './run-with-next-server.js';

const targets = [
  { path: '/', reportPath: '.lighthouse-home.json' },
  { path: '/services/house-removals', reportPath: '.lighthouse-service.json' },
  { path: '/removals/paisley', reportPath: '.lighthouse-location.json' },
  { path: '/removals/glasgow-to-edinburgh', reportPath: '.lighthouse-route.json' },
] as const;

async function runLighthouse(baseUrl: string): Promise<number> {
  for (const target of targets) {
    const lighthouseCode = await runCommand(npxExecutable, [
      'lighthouse',
      `${baseUrl}${target.path}`,
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
}

const exitCode = process.env.LIGHTHOUSE_BASE_URL
  ? await runLighthouse(process.env.LIGHTHOUSE_BASE_URL.replace(/\/$/, ''))
  : await withNextServer(async () => runLighthouse(localServerUrl));

process.exitCode = exitCode;
