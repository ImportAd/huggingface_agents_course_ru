import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results/browser',
  use: { baseURL: process.env.READER_TEST_URL || 'http://127.0.0.1:5173', channel: 'chrome', headless: true, viewport: { width: 1536, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: process.env.READER_TEST_URL ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60000 },
});
