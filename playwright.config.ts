import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:3004/api/health",
      reuseExistingServer: true,
      timeout: 20_000
    },
    {
      command: "npm run dev:client",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: true,
      timeout: 20_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
