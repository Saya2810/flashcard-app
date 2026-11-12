import { defineConfig, devices } from '@playwright/test';

// The E2E tests run against the PRODUCTION build (with service worker) in an iPhone viewport.
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 14'],
    browserName: 'chromium', // no WebKit download needed; this checks layout and logic, not Safari itself
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    // Optional: use an existing Chromium instead of `npx playwright install chromium`
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
