import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { issueAccess } from "../../src/lib/server/issues";
import type { requireWorkspace } from "../../src/lib/server/auth";
const savedEnv = { ...process.env },
  savedFetch = globalThis.fetch;
const id = "11111111-1111-4111-8111-111111111111",
  wid = "22222222-2222-4222-8222-222222222222";
const context = {
  db: createClient("http://issues.test", "fixture", {
    auth: { persistSession: false },
  }),
  workspaceId: wid,
  user: { id },
  role: "owner",
} as unknown as Awaited<ReturnType<typeof requireWorkspace>>;
let permission = "read",
  created = 0,
  reserved = false;
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
beforeEach(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: "https://flowguard.test",
    NEXT_PUBLIC_SUPABASE_URL: "http://issues.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
    SUPABASE_SECRET_KEY: "sb_secret_fixture_only",
    GITHUB_APP_ID: "123",
    GITHUB_APP_SLUG: "fixture",
    GITHUB_APP_PRIVATE_KEY: key,
    SENTRY_DSN: "",
  });
  permission = "read";
  created = 0;
  reserved = false;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init),
      u = new URL(req.url);
    const result = (data: unknown, status = 200) => {
      const r = Response.json(data, { status });
      Object.defineProperty(r, "url", { value: req.url });
      return r;
    };
    if (u.hostname === "api.github.com") {
      if (u.pathname.endsWith("access_tokens")) {
        const body = await req.json();
        assert.deepEqual(body.permissions, {
          metadata: "read",
          issues: "write",
        });
        assert.deepEqual(body.repository_ids, [456]);
        return result({ token: "fixture-installation-token" });
      }
      if (u.pathname.endsWith("/issues")) {
        created++;
        const body = await req.json();
        assert.match(body.body, /Preserve security/);
        return result(
          { html_url: "https://github.com/alice/site/issues/1" },
          201,
        );
      }
      return result({ permissions: { issues: permission } });
    }
    assert.equal(u.hostname, "issues.test");
    const table = u.pathname.split("/").at(-1)!;
    if (table === "run_issue_links") {
      if (req.method === "POST") {
        if (reserved)
          return result({ code: "23505", message: "duplicate" }, 409);
        reserved = true;
        return new Response(null, { status: 201 });
      }
      if (req.method === "PATCH") return new Response(null, { status: 204 });
      return result({ issue_url: "https://github.com/alice/site/issues/1" });
    }
    if (table === "projects")
      return result({
        id,
        workspace_id: wid,
        name: "Fixture",
        target_url: "https://example.com",
        repository_id: id,
        description: "",
        created_at: new Date().toISOString(),
      });
    if (table === "repositories")
      return result({
        id,
        full_name: "alice/site",
        github_installation_id: id,
        github_repository_id: 456,
        owner_login: "alice",
        name: "site",
        sync_status: "connected",
      });
    if (table === "github_installations")
      return result({
        id,
        github_installation_id: 123,
        installation_status: "connected",
      });
    if (table === "runs") {
      const row = {
        id,
        number: 1,
        project_id: id,
        journey_id: id,
        journey_name: "Heading",
        status: "failed",
        started_at: new Date().toISOString(),
        duration_ms: 100,
        branch: "main",
        commit_sha: "a".repeat(40),
        environment: "https://example.com",
        browser: "Chromium",
        logs: [],
      };
      return result(
        req.headers.get("accept")?.includes("vnd.pgrst.object") ? row : [row],
      );
    }
    throw new Error("Unexpected fixture request");
  };
});
after(() => {
  process.env = savedEnv;
  globalThis.fetch = savedFetch;
});
test("issue creation requires explicit permission and the reviewed body", async () => {
  const denied = await issueAccess(context, id, true);
  assert.equal(denied.available, false);
  assert.equal(created, 0);
  assert.equal(reserved, false);
  permission = "write";
  const review = await issueAccess(context, id);
  assert.equal(review.available, true);
  assert.ok("bodyHash" in review);
  await assert.rejects(
    issueAccess(context, id, true, "unreviewed"),
    /evidence changed/,
  );
  assert.equal(created, 0);
  const posted = await issueAccess(
    context,
    id,
    true,
    (review as { bodyHash: string }).bodyHash,
  );
  assert.match(posted.url!, /issues\/1/);
  assert.equal(created, 1);
  await issueAccess(
    context,
    id,
    true,
    (review as { bodyHash: string }).bodyHash,
  );
  assert.equal(created, 1);
});
