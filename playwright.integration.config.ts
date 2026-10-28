import { defineConfig } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
export default defineConfig({
  outputDir: "test-results/integration",
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
      command: "node tests/fixtures/measure-proxy.mjs",
      url: "http://127.0.0.1:4546/measure/results",
      reuseExistingServer: false,
    },
    {
      command:
        "npm run build && npm run start -- --hostname 127.0.0.1 --port 3010",
      url: "http://127.0.0.1:3010/login",
      reuseExistingServer: false,
      timeout: 120000,
      env: {
        FLOWGUARD_TEST_DIST: ".next-auth-test",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3010",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4546",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_local_test_fixture_only",
        SUPABASE_SECRET_KEY: "sb_secret_local_fixture_only",
        GITHUB_APP_ID: "123",
        GITHUB_APP_SLUG: "fixture-flowguard",
        GITHUB_APP_PRIVATE_KEY: generateKeyPairSync("rsa", {
          modulusLength: 2048,
        })
          .privateKey.export({ format: "pem", type: "pkcs8" })
          .toString(),
        NODE_OPTIONS: `--import ${resolve("tests/fixtures/github-fetch.mjs")}`,
      },
    },
  ],
});
