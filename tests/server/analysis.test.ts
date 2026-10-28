// Real OpenAI/Supabase clients; transport is intercepted in this test process only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { analyzeFailure } from "../../src/lib/server/analysis";
import { runReport } from "../../src/lib/server/reports";
import type { requireWorkspace } from "../../src/lib/server/auth";
const originalFetch = globalThis.fetch,
  originalEnv = { ...process.env };
const wid = "22222222-2222-4222-8222-222222222222",
  id = "11111111-1111-4111-8111-111111111111";
const context = {
  db: createClient("http://analysis.test", "fixture", {
    auth: { persistSession: false },
  }),
  workspaceId: wid,
  user: { id: "33333333-3333-4333-8333-333333333333" },
  role: "owner",
} as unknown as Awaited<ReturnType<typeof requireWorkspace>>;
let mode = "provider-failure",
  providerCalls = 0,
  finished: Record<string, unknown> | null = null;
const run = {
  id,
  number: 1,
  project_id: id,
  journey_id: id,
  journey_name: "Fixture",
  status: "failed",
  started_at: new Date().toISOString(),
  duration_ms: 500,
  branch: "main",
  commit_sha: "a".repeat(40),
  commit_message: "",
  environment: "https://example.com",
  browser: "Chromium",
  failure_category: "APPLICATION_FAILURE",
  error_message: "Mismatch",
  assertion: {
    expected: "Ready",
    received: "Pending",
    locator: "heading",
    timeout: 500,
  },
  run_steps: [],
  logs: [],
};
beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://flowguard.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://analysis.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture";
  process.env.OPENAI_API_KEY = "fixture-never-used-externally";
  delete process.env.FLOWGUARD_AI_MODEL;
  process.env.SENTRY_DSN = "";
  mode = "provider-failure";
  providerCalls = 0;
  finished = null;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url);
    if (url.hostname === "api.openai.com") {
      providerCalls++;
      assert.equal(request.method, "POST");
      const sent = await request.json();
      assert.equal(sent.store, false);
      assert.equal(sent.max_output_tokens, 1200);
      assert.ok(!JSON.stringify(sent).includes("sb_secret_fixture"));
      return Response.json(
        {
          error: {
            message: "Fixture provider unavailable",
            type: "server_error",
          },
        },
        { status: 503 },
      );
    }
    assert.equal(url.hostname, "analysis.test");
    if (url.pathname.endsWith("investigation_operation")) {
      const body = await request.json();
      if (body.op === "finish") {
        finished = body.args;
        return Response.json({ ok: true });
      }
      if (mode === "quota")
        return Response.json(
          { code: "P0001", message: "Analysis rate limit reached" },
          { status: 400 },
        );
      if (mode === "pending")
        return Response.json({ cached: true, status: "pending" });
      return Response.json({ cached: false, id });
    }
    if (url.pathname.endsWith("projects"))
      return Response.json({
        id,
        name: "Fixture",
        target_url: "https://example.com",
        description: "",
        created_at: new Date().toISOString(),
      });
    if (url.pathname.endsWith("runs"))
      return Response.json(
        request.headers.get("accept")?.includes("vnd.pgrst.object")
          ? run
          : [run],
      );
    throw new Error("Unexpected test transport destination");
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});
test("provider failure is bounded, persisted and leaves deterministic prompts available", async () => {
  const report = await runReport(context, id);
  await assert.rejects(
    analyzeFailure(context, id, report.ai.evidenceHash),
    /unavailable, timed out or returned invalid/,
  );
  assert.equal(providerCalls, 1);
  assert.equal(
    (finished as Record<string, unknown> | null)?.error_code,
    "provider_or_validation_failure",
  );
  assert.ok((await runReport(context, id)).prompt);
});
test("quota exhaustion and pending dedup make no provider request", async () => {
  const report = await runReport(context, id);
  for (const next of ["quota", "pending"]) {
    mode = next;
    await assert.rejects(
      analyzeFailure(context, id, report.ai.evidenceHash),
      next === "quota" ? /quota reached/ : /already pending/,
    );
  }
  assert.equal(providerCalls, 0);
});
test("disabled analysis and unreviewed evidence make no provider request", async () => {
  const report = await runReport(context, id);
  await assert.rejects(
    analyzeFailure(context, id, "unreviewed"),
    /Evidence changed/,
  );
  process.env.OPENAI_API_KEY = "";
  await assert.rejects(
    analyzeFailure(context, id, report.ai.evidenceHash),
    /not configured/,
  );
  assert.equal(providerCalls, 0);
});
