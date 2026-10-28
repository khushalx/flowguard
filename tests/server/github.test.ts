// Server-service tests: real Octokit/Supabase clients against mocked HTTP.
// RLS and transactional behavior are tested separately against PostgreSQL.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  connectInstallation,
  discoverInstallation,
  syncRepositories,
  verifyRepositoryAccess,
} from "../../src/lib/server/github";
import type { requireWorkspace } from "../../src/lib/server/auth";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const iid = "11111111-1111-4111-8111-111111111111";
const wid = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;
let rows: Record<string, Row[]>;
let calls: string[];
let installed: boolean;
let status: number;
let limited: boolean;
let accountId: number;
let repositoryIds: number[];
let collision: boolean;
let version: number;
const context = {
  db: createClient("http://database.test", "sb_publishable_fixture_only", {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  user: { id: "33333333-3333-4333-8333-333333333333" },
  workspaceId: wid,
  role: "owner",
  member: {},
} as unknown as Awaited<ReturnType<typeof requireWorkspace>>;
function installationRow(extra: Row = {}) {
  return {
    id: iid,
    workspace_id: wid,
    github_installation_id: 123,
    github_account_id: 1001,
    github_account_login: "alice",
    account_type: "User",
    installation_status: "connected",
    needs_sync: false,
    updated_at: "v0",
    last_synced_at: null,
    disconnected_at: null,
    ...extra,
  };
}
function response(
  request: Request,
  data: unknown,
  code = 200,
  headers: Record<string, string> = {},
) {
  const result = Response.json(data, { status: code, headers });
  Object.defineProperty(result, "url", { value: request.url });
  return result;
}
beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://database.test";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_fixture_only";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_fixture_only";
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_APP_SLUG = "fixture-app";
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
  rows = {
    profiles: [{ id: context.user.id, github_user_id: 1001 }],
    github_installations: [],
    repositories: [],
  };
  calls = [];
  installed = true;
  status = 200;
  limited = false;
  accountId = 1001;
  repositoryIds = [456, 457];
  collision = false;
  version = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init),
      url = new URL(request.url);
    calls.push(`${request.method} ${url.hostname}${url.pathname}`);
    const body =
      request.method === "GET" ? {} : ((await request.json()) as Row);
    if (url.hostname === "api.github.com") {
      if (url.pathname === "/user/1001")
        return response(request, { id: 1001, type: "User", login: "alice" });
      if (status !== 200)
        return response(
          request,
          { message: "Mock GitHub failure" },
          status,
          limited ? { "x-ratelimit-remaining": "0" } : {},
        );
      if (!installed) return response(request, { message: "Not Found" }, 404);
      if (url.pathname.endsWith("/access_tokens"))
        return response(request, {
          token: "fixture-installation-token",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        });
      if (url.pathname === "/installation/repositories")
        return response(request, {
          total_count: repositoryIds.length,
          repositories: repositoryIds.map((id) => ({
            id,
            owner: { login: "alice" },
            name: `repo-${id}`,
            full_name: `alice/repo-${id}`,
            private: true,
            default_branch: "main",
            html_url: `https://github.com/alice/repo-${id}`,
          })),
        });
      return response(request, {
        id: 123,
        account: { id: accountId, type: "User", login: "alice" },
        suspended_at: null,
      });
    }
    assert.equal(url.hostname, "database.test");
    if (url.pathname.endsWith("/rpc/sync_installation_repositories")) {
      rows.repositories = (body.repos as Row[]).map((r) => ({
        id: `repo-${r.id}`,
        workspace_id: wid,
        github_installation_id: iid,
        github_repository_id: r.id,
        full_name: r.fullName,
        sync_status: "connected",
      }));
      rows.github_installations[0].last_synced_at = new Date().toISOString();
      rows.github_installations[0].needs_sync = false;
      return response(request, null);
    }
    const table = url.pathname.split("/").at(-1)!;
    const matches = (r: Row) =>
      [...url.searchParams].every(([key, value]) => {
        if (key === "select" || key === "order") return true;
        if (value.startsWith("eq.")) return String(r[key]) === value.slice(3);
        if (value.startsWith("in.("))
          return value.slice(4, -1).split(",").includes(String(r[key]));
        throw new Error(`Unsupported mock filter ${key}`);
      });
    if (request.method === "POST") {
      if (collision) {
        rows[table].push(installationRow());
        collision = false;
        return response(request, { code: "23505", message: "duplicate" }, 409);
      }
      rows[table].push({ ...body, id: iid, updated_at: `v${++version}` });
    }
    let found = rows[table].filter(matches);
    if (request.method === "PATCH")
      found.forEach((r) =>
        Object.assign(r, body, { updated_at: `v${++version}` }),
      );
    if (request.method === "POST") found = [rows[table].at(-1)!];
    if (request.headers.get("accept")?.includes("vnd.pgrst.object+json"))
      return found.length === 1
        ? response(request, found[0])
        : response(
            request,
            { code: "PGRST116", message: "No matching row" },
            406,
          );
    return response(request, found);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
});
test("existing unclaimed personal installation is discovered, verified and populated once", async () => {
  assert.equal(await discoverInstallation(context), true);
  assert.equal(rows.github_installations.length, 1);
  assert.equal(rows.repositories.length, 2);
  assert.equal(rows.repositories[0].sync_status, "connected");
  const count = calls.length;
  assert.equal(await discoverInstallation(context), true);
  assert.equal(calls.length, count + 1); // Only workspace-scoped freshness lookup.
  assert.equal(calls.filter((c) => c.includes("access_tokens")).length, 1);
});
test("missing installation stays unconnected without an installation claim", async () => {
  installed = false;
  assert.equal(await discoverInstallation(context), false);
  assert.equal(rows.github_installations.length, 0);
});
test("spoofed installation owner and cross-workspace claims are rejected", async () => {
  accountId = 999;
  await assert.rejects(connectInstallation(context, 123), /not owned/);
  assert.equal(rows.github_installations.length, 0);
  accountId = 1001;
  rows.github_installations = [
    installationRow({ workspace_id: "other-workspace" }),
  ];
  await assert.rejects(connectInstallation(context, 123), /another workspace/);
  assert.equal(rows.github_installations[0].workspace_id, "other-workspace");
});
test("duplicate callbacks cannot create duplicate installation records", async () => {
  collision = true;
  await connectInstallation(context, 123);
  assert.equal(rows.github_installations.length, 1);
  assert.equal(rows.repositories.length, 2);
});
test("explicit disconnect is respected by automatic discovery", async () => {
  rows.github_installations = [
    installationRow({
      disconnected_at: new Date().toISOString(),
      installation_status: "access_required",
    }),
  ];
  assert.equal(await discoverInstallation(context), false);
  assert.equal(calls.filter((c) => c.includes("api.github.com")).length, 0);
  assert.equal(await discoverInstallation(context, true), true);
  assert.equal(rows.github_installations[0].disconnected_at, null);
});
test("repository additions/removals reconcile and revoked selection is rejected", async () => {
  await connectInstallation(context, 123);
  repositoryIds = [457, 458];
  await syncRepositories(context, iid);
  assert.deepEqual(
    rows.repositories.map((r) => Number(r.github_repository_id)),
    [457, 458],
  );
  await assert.rejects(
    verifyRepositoryAccess(context, "repo-456"),
    /not accessible/,
  );
});
test("deleted installation, permission failure and rate limit get distinct recoverable states", async () => {
  for (const [http, rate, expected] of [
    [404, false, "removed"],
    [403, false, "access_required"],
    [403, true, "sync_failed"],
    [503, false, "sync_failed"],
  ] as const) {
    rows.github_installations = [installationRow()];
    rows.repositories = [
      {
        id: "repo-456",
        github_installation_id: iid,
        workspace_id: wid,
        sync_status: "connected",
      },
    ];
    status = http;
    limited = rate;
    await assert.rejects(syncRepositories(context, iid));
    assert.equal(rows.github_installations[0].installation_status, expected);
    assert.equal(rows.repositories[0].sync_status, expected);
    assert.equal(calls.filter((c) => c.includes("access_tokens")).length, 0);
  }
});
