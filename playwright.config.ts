import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/browser",
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/integration/**",
  fullyParallel: true,
  workers: 3,
  timeout: 45000,
  expect: { timeout: 8000 },
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3020", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3020",
    env: {
      OPENAI_API_KEY: "",
      SENTRY_DSN: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      FLOWGUARD_TEST_DIST: ".next-e2e-test",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3020",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SECRET_KEY: "",
      GITHUB_APP_ID: "",
      GITHUB_APP_SLUG: "",
      GITHUB_APP_PRIVATE_KEY: "",
      GITHUB_WEBHOOK_SECRET: "",
    },
    url: "http://127.0.0.1:3020/app",
    reuseExistingServer: false,
  },
});
