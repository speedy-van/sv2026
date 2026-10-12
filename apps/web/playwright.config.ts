import { existsSync } from 'node:fs';
import process from 'node:process';

import { defineConfig, devices } from '@playwright/test';

const windowsChromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browserChannel =
  process.env.PLAYWRIGHT_BROWSER_CHANNEL ??
  (process.platform === 'win32' && existsSync(windowsChromePath) ? 'chrome' : undefined);
const chromiumUse = browserChannel === undefined ? {} : { channel: browserChannel };

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...chromiumUse },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], ...chromiumUse },
    },
  ],
});
