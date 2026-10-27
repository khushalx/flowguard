import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appOrigin,
  authConfigurationIssues,
  publicConfig,
} from "../../src/lib/env";

// Synthetic values only. No local/deployment credentials are loaded by this test.
const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_key",
  NEXT_PUBLIC_APP_URL: "https://flowguard.example.com",
};
function withEnvironment(
  values: Record<string, string | undefined>,
  check: () => void,
) {
  const saved = Object.keys(values).map(
    (key) => [key, process.env[key]] as const,
  );
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    check();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the standard Supabase names and canonical URL enable sign-in without GitHub App or secret keys", () => {
  withEnvironment(
    {
      ...valid,
      SUPABASE_SECRET_KEY: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      GITHUB_APP_ID: undefined,
      GITHUB_APP_SLUG: undefined,
      GITHUB_APP_PRIVATE_KEY: undefined,
      GITHUB_WEBHOOK_SECRET: undefined,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    },
    () => {
      assert.ok(publicConfig());
      assert.deepEqual(authConfigurationIssues(), []);
    },
  );
});

test("each missing auth variable is identified by name without blaming GitHub App configuration", () => {
  for (const name of Object.keys(valid)) {
    withEnvironment({ ...valid, [name]: undefined }, () => {
      const issues = authConfigurationIssues();
      assert.equal(issues.length, 1);
      assert.ok(issues[0].startsWith(name + " "));
      assert.equal(issues[0].includes("GITHUB_APP"), false);
    });
  }
});

test("invalid URL and private/legacy keys remain rejected and are never included in diagnostics", () => {
  for (const key of [
    "sb_secret_fixture_never_render",
    "fixture-service-role-jwt",
    "eyJfixture-legacy-anon-key",
  ]) {
    withEnvironment(
      { ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
      () => {
        assert.equal(publicConfig(), null);
        const issues = authConfigurationIssues();
        assert.equal(issues.length, 1);
        assert.ok(
          issues[0].startsWith("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "),
        );
        assert.equal(issues.join().includes(key), false);
      },
    );
  }
  withEnvironment(
    { ...valid, NEXT_PUBLIC_SUPABASE_URL: "invalid-project-url" },
    () => {
      assert.equal(publicConfig(), null);
      assert.ok(
        authConfigurationIssues()[0].startsWith("NEXT_PUBLIC_SUPABASE_URL "),
      );
    },
  );
});

test("production canonical origin security is preserved and missing APP_URL is reported independently", () => {
  for (const origin of [
    undefined,
    "http://flowguard.example.com",
    "https://flowguard.example.com/login",
    "https://flowguard.example.com?next=evil",
    "https://user:password@flowguard.example.com",
  ]) {
    withEnvironment(
      { ...valid, NODE_ENV: "production", NEXT_PUBLIC_APP_URL: origin },
      () => {
        assert.ok(publicConfig());
        assert.throws(() => appOrigin());
        const issues = authConfigurationIssues();
        assert.equal(issues.length, 1);
        assert.ok(issues[0].startsWith("NEXT_PUBLIC_APP_URL "));
        if (origin) assert.equal(issues.join().includes(origin), false);
      },
    );
  }
});
