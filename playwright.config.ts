import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.VITE_DEV_PORT) || 5173;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
