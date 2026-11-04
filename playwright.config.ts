import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'msedge', viewport: { width: 1280, height: 900 } },
  workers: 1,
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI, timeout: 30000 },
});
