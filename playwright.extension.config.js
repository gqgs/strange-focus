import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/extension', outputDir: './extension-test-results', timeout: 60000, workers: 1, reporter: 'list', use: { trace: 'retain-on-failure' } });
