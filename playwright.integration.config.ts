import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/integration",
  workers: 1,
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:3010", trace: "retain-on-failure" },
  webServer: [
    {
      command: "node --import tsx tests/fixtures/supabase.ts",
      url: "http://127.0.0.1:4545/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --hostname 127.0.0.1 --port 3010",
      url: "http://127.0.0.1:3010/login",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        FLOWGUARD_TEST_DIST: ".next-auth-test",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4545",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_local_test_fixture_only",
        SUPABASE_SECRET_KEY: "",
        GITHUB_APP_ID: "",
        GITHUB_APP_SLUG: "",
        GITHUB_APP_PRIVATE_KEY: "",
      },
    },
  ],
});
