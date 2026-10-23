import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1050 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: 'python3 -m http.server 5173 --bind 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, stdout: 'ignore', stderr: 'ignore' },
});
