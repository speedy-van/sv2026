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
  fullyParallel: false,
  reporter: [['list']],
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
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
  workers: 1,
});
