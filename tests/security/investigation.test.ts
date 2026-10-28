import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const alice = randomUUID(),
  bob = randomUUID();
let aw: string, bw: string;
let seq = 100;
const definition = {
  version: 1,
  steps: [
    {
      action: "assertVisible",
      locator: { type: "role", value: "heading" },
      timeoutMs: 500,
    },
  ],
  timeoutMs: 10000,
  captureArtifacts: false,
};
async function query<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) {
  return (await db.query<T>(sql, args)).rows;
}
async function scalar(sql: string, args: unknown[] = []) {
  return Object.values((await query(sql, args))[0])[0] as string;
}
async function user(id: string) {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function service() {
  await db.exec("reset role;set role service_role;");
}
async function op(name: string, args: Record<string, unknown> = {}) {
  await service();
  return (await scalar("select public.engine_operation($1,$2)", [
    name,
    JSON.stringify(args),
  ])) as unknown as Record<string, unknown>;
}
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;insert into auth.users values('${alice}'),('${bob}');insert into auth.identities values('${alice}','github','1001','{"user_name":"alice"}'),('${bob}','github','1002','{"user_name":"bob"}');`,
  );
  for (const file of readdirSync("supabase/migrations").sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await user(alice);
  aw = await scalar("select public.bootstrap_workspace()");
  await user(bob);
  bw = await scalar("select public.bootstrap_workspace()");
});
after(async () => db.close());
async function fixture(owner = alice, workspace = aw) {
  await service();
  const n = ++seq;
  const installation = await scalar(
    "insert into public.github_installations(workspace_id,github_installation_id,github_account_id,github_account_login,account_type,installation_status) values($1,$2,$3,$4,'User','connected') returning id",
    [
      workspace,
      n,
      owner === alice ? 1001 : 1002,
      owner === alice ? "alice" : "bob",
    ],
  );
  const repository = await scalar(
    "insert into public.repositories(workspace_id,github_repository_id,github_installation_id,owner_login,name,full_name,default_branch,is_private,html_url,sync_status) values($1,$2,$3,'alice','site','alice/site','main',true,'https://github.com/alice/site','connected') returning id",
    [workspace, n, installation],
  );
  const project = await scalar(
    "insert into public.projects(workspace_id,name,target_url,repository_id) values($1,$2,'https://public.example.com',$3) returning id",
    [workspace, `Project ${n}`, repository],
  );
  const journey = await scalar(
    "insert into public.journeys(project_id,name,start_path,success_condition,configuration) values($1,'Heading','/','Legacy note',$2) returning id",
    [project, JSON.stringify(definition)],
  );
  const args = {
    project_id: project,
    workspace_id: workspace,
    actor_id: owner,
  };
  await op("credential", { ...args, verifier: String(n).padStart(64, "a") });
  return {
    args,
    project,
    journey,
    repository,
    credential: String(n).padStart(64, "a"),
  };
}
async function queued(
  f: Awaited<ReturnType<typeof fixture>>,
  requestId = randomUUID(),
) {
  return op("queue", {
    ...f.args,
    request_id: requestId,
    journey_ids: [f.journey],
    workflow_id: 5,
  });
}
async function claim(
  f: Awaited<ReturnType<typeof fixture>>,
  batchId: unknown,
  hash = createHash("sha256").update(randomUUID()).digest("hex"),
) {
  await op("claim", {
    batch_id: batchId,
    credential_verifier: f.credential,
    token_verifier: hash,
    github_run_id: 123,
    commit_sha: "a".repeat(40),
  });
  return hash;
}
const passed = {
  status: "passed",
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
  duration: 10,
  failureCategory: null,
  error: null,
  steps: [
    {
      name: "Open starting path",
      detail: "/",
      status: "passed",
      duration: 5,
      startedAt: new Date().toISOString(),
    },
    {
      name: "assertVisible",
      detail: "",
      status: "passed",
      duration: 5,
      startedAt: new Date().toISOString(),
    },
  ],
  logs: [],
};

async function failedRun(f: Awaited<ReturnType<typeof fixture>>) {
  const batch = await queued(f),
    hash = await claim(f, batch.id);
  const id = await scalar("select id from public.runs where batch_id=$1", [
    batch.id,
  ]);
  const result = {
    ...passed,
    status: "failed",
    failureCategory: "APPLICATION_FAILURE",
    error: "Expected heading",
    assertion: {
      expected: "Visible",
      received: "Missing",
      locator: "heading",
      timeout: 500,
    },
    steps: passed.steps.map((s, i) => ({
      ...s,
      name: i ? "assertVisible" : "Open starting path",
      status: i ? "failed" : "passed",
    })),
  };
  await op("start", { batch_id: batch.id, run_id: id, token_verifier: hash });
  await op("complete", {
    batch_id: batch.id,
    run_id: id,
    token_verifier: hash,
    result,
    digest: "f".repeat(64),
  });
  return { id, batch, hash, result };
}
test("verification copies the immutable snapshot, preserves failures and cannot cross workspaces", async () => {
  const f = await fixture(),
    original = await failedRun(f);
  await query(
    "update public.journeys set name='Edited',configuration=jsonb_set(configuration,'{timeoutMs}','11000') where id=$1",
    [f.journey],
  );
  const key = randomUUID(),
    args = {
      ...f.args,
      request_id: key,
      journey_ids: [f.journey],
      workflow_id: 5,
      source_run_id: original.id,
    };
  const verified = await op("queue", args),
    repeated = await op("queue", args);
  assert.equal(repeated.id, verified.id);
  assert.equal(repeated.duplicate, true);
  const next = (
    await query<{
      id: string;
      verification_of: string;
      configuration: unknown;
      journey_name: string;
    }>(
      "select id,verification_of,configuration,journey_name from public.runs where batch_id=$1",
      [verified.id],
    )
  )[0];
  assert.equal(next.verification_of, original.id);
  assert.equal(next.journey_name, "Heading");
  const prior = (
    await query<{ configuration: unknown }>(
      "select configuration from public.runs where id=$1",
      [original.id],
    )
  )[0];
  assert.deepEqual(next.configuration, prior.configuration);
  await assert.rejects(
    op("queue", {
      ...args,
      request_id: randomUUID(),
      workspace_id: bw,
      actor_id: bob,
    }),
    /no rows|permission/i,
  );
  await assert.rejects(
    op("queue", { ...args, journey_ids: [randomUUID()] }),
    /mismatch/,
  );
  const hash = await claim(f, verified.id);
  await op("start", {
    batch_id: verified.id,
    run_id: next.id,
    token_verifier: hash,
  });
  await op("complete", {
    batch_id: verified.id,
    run_id: next.id,
    token_verifier: hash,
    result: passed,
    digest: "p".repeat(64),
  });
  assert.equal(
    await scalar("select status from public.runs where id=$1", [original.id]),
    "failed",
  );
  assert.equal(
    await scalar(
      "select count(*)::text from public.workspace_events where run_id=$1 and kind='regression_resolved'",
      [next.id],
    ),
    "1",
  );
});
test("failure events are deduplicated and browser writes/foreign reads are denied", async () => {
  const f = await fixture(),
    first = await failedRun(f);
  await op("complete", {
    batch_id: first.batch.id,
    run_id: first.id,
    token_verifier: first.hash,
    result: first.result,
    digest: "f".repeat(64),
  });
  assert.equal(
    await scalar(
      "select count(*)::text from public.workspace_events where run_id=$1",
      [first.id],
    ),
    "1",
  );
  const second = await failedRun(f);
  assert.equal(
    await scalar("select kind from public.workspace_events where run_id=$1", [
      second.id,
    ]),
    "repeated_failure",
  );
  await user(bob);
  for (const table of [
    "workspace_events",
    "failure_analyses",
    "run_issue_links",
  ])
    assert.equal(
      await scalar(`select count(*)::text from public.${table}`),
      "0",
    );
  await assert.rejects(
    query(
      "insert into public.workspace_events(workspace_id,run_id,kind) values($1,$2,'new_failure')",
      [aw, first.id],
    ),
    /permission/,
  );
  await assert.rejects(
    query("select public.investigation_operation('reserve','{}')"),
    /permission/,
  );
  await assert.rejects(
    query(
      "insert into public.notification_preferences(workspace_id,user_id) values($1,$2)",
      [aw, bob],
    ),
    /row-level/,
  );
  await user(alice);
  await query(
    "insert into public.notification_preferences(workspace_id,user_id,in_app) values($1,$2,false)",
    [aw, alice],
  );
  assert.equal(
    await scalar("select in_app::text from public.notification_preferences"),
    "false",
  );
});
test("AI reservation deduplicates, persists errors, enforces quotas and denies other actors", async () => {
  const f = await fixture(),
    run = await failedRun(f);
  const args = {
    workspace_id: aw,
    actor_id: alice,
    run_id: run.id,
    evidence_hash: "a".repeat(64),
    model: "fixture-model",
    reserved_usd: 0.01,
  };
  const reserve = (args: Record<string, unknown>) =>
    scalar("select public.investigation_operation($1,$2)", [
      "reserve",
      JSON.stringify(args),
    ]) as unknown as Promise<Record<string, unknown>>;
  await service();
  const a = await reserve(args),
    b = await reserve(args);
  assert.equal(b.id, a.id);
  assert.equal(b.cached, true);
  await assert.rejects(reserve({ ...args, actor_id: bob }), /permission/i);
  await scalar("select public.investigation_operation($1,$2)", [
    "finish",
    JSON.stringify({
      ...args,
      id: a.id,
      output: null,
      error_code: "provider_or_validation_failure",
    }),
  ]);
  const cached = await reserve(args);
  assert.equal(cached.status, "error");
  for (let i = 1; i < 5; i++)
    await reserve({ ...args, evidence_hash: String(i).padStart(64, "0") });
  await assert.rejects(
    reserve({ ...args, evidence_hash: "rate" }),
    /rate limit/i,
  );
  await query(
    "update public.failure_analyses set created_at=now()-interval '2 minutes' where workspace_id=$1",
    [aw],
  );
  for (let i = 5; i < 20; i++) {
    await reserve({ ...args, evidence_hash: String(i).padStart(64, "0") });
    await query(
      "update public.failure_analyses set created_at=now()-interval '2 minutes' where workspace_id=$1",
      [aw],
    );
  }
  await assert.rejects(
    reserve({ ...args, evidence_hash: "over quota" }),
    /Daily analysis quota/i,
  );
  await user(bob);
  assert.equal(
    await scalar("select count(*)::text from public.failure_analyses"),
    "0",
  );
});

test("a changed execution repository cannot emit regression resolved", async () => {
  const f = await fixture(),
    original = await failedRun(f);
  const next = await op("queue", {
    ...f.args,
    request_id: randomUUID(),
    journey_ids: [f.journey],
    workflow_id: 5,
    source_run_id: original.id,
  });
  await query(
    "update public.execution_batches set repository_name='alice/different-site' where id=$1",
    [next.id],
  );
  const id = await scalar("select id from public.runs where batch_id=$1", [
      next.id,
    ]),
    hash = await claim(f, next.id);
  await op("start", { batch_id: next.id, run_id: id, token_verifier: hash });
  await op("complete", {
    batch_id: next.id,
    run_id: id,
    token_verifier: hash,
    result: passed,
    digest: "q".repeat(64),
  });
  assert.equal(
    await scalar(
      "select count(*)::text from public.workspace_events where run_id=$1 and kind='regression_resolved'",
      [id],
    ),
    "0",
  );
});
