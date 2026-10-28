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

test("browser sessions cannot create batches, credentials, tokens, steps or passing results", async () => {
  const f = await fixture();
  await user(alice);
  await assert.rejects(
    query("select public.engine_operation('queue',$1)", [
      JSON.stringify({
        ...f.args,
        request_id: randomUUID(),
        journey_ids: [f.journey],
      }),
    ]),
    /permission denied/,
  );
  await assert.rejects(
    query("select * from private.runner_credentials"),
    /permission denied/,
  );
  await assert.rejects(
    query(
      "insert into public.runs(project_id,journey_name,status) values($1,'Forged','passed')",
      [f.project],
    ),
    /permission denied/,
  );
  await assert.rejects(
    query(
      "insert into public.execution_batches(workspace_id,project_id,requested_by,request_id,repository_name,github_repository_id,installation_id,branch) values($1,$2,$3,$4,'x',1,1,'main')",
      [aw, f.project, alice, randomUUID()],
    ),
    /permission denied/,
  );
});
test("queue is idempotent, snapshots configuration and enforces project concurrency", async () => {
  const f = await fixture(),
    key = randomUUID();
  const a = await queued(f, key),
    again = await queued(f, key);
  assert.equal(a.id, again.id);
  assert.equal(again.duplicate, true);
  await assert.rejects(queued(f), /already active/);
  await service();
  assert.equal(
    await scalar("select count(*)::text from public.runs where batch_id=$1", [
      a.id,
    ]),
    "1",
  );
  await user(bob);
  assert.equal(
    await scalar(
      "select count(*)::text from public.execution_batches where id=$1",
      [a.id],
    ),
    "0",
  );
  await op("terminate", {
    batch_id: a.id,
    status: "cancelled",
    error: "test cancellation",
  });
});
test("claim rejects wrong repository credentials, is single-use and results complete exactly once", async () => {
  const f = await fixture(),
    batch = await queued(f);
  await assert.rejects(
    op("claim_context", {
      batch_id: batch.id,
      credential_verifier: "x".repeat(64),
    }),
    /Invalid runner credential/,
  );
  const hash = await claim(f, batch.id);
  await assert.rejects(claim(f, batch.id, "z".repeat(64)), /cannot be claimed/);
  const runId = await scalar("select id from public.runs where batch_id=$1", [
    batch.id,
  ]);
  const args = { batch_id: batch.id, run_id: runId, token_verifier: hash };
  await op("start", args);
  const first = await op("complete", {
    ...args,
    result: passed,
    digest: "c".repeat(64),
  });
  assert.equal(first.duplicate, false);
  const repeated = await op("complete", {
    ...args,
    result: passed,
    digest: "c".repeat(64),
  });
  assert.equal(repeated.duplicate, true);
  await assert.rejects(
    op("complete", {
      ...args,
      result: { ...passed, status: "failed" },
      digest: "d".repeat(64),
    }),
    /Terminal results/,
  );
  assert.equal(
    await scalar("select status from public.execution_batches where id=$1", [
      batch.id,
    ]),
    "passed",
  );
  assert.equal(
    await scalar(
      "select count(*)::text from public.run_steps where run_id=$1",
      [runId],
    ),
    "2",
  );
});
test("scoped token cannot submit a result to another batch or workspace", async () => {
  const a = await fixture(),
    b = await fixture(bob, bw),
    ab = await queued(a),
    bb = await queued(b);
  const hash = await claim(a, ab.id);
  const bRun = await scalar("select id from public.runs where batch_id=$1", [
    bb.id,
  ]);
  await assert.rejects(
    op("complete", {
      batch_id: bb.id,
      run_id: bRun,
      token_verifier: hash,
      result: passed,
      digest: "e".repeat(64),
    }),
    /Invalid or expired/,
  );
  await assert.rejects(
    op("complete", {
      batch_id: ab.id,
      run_id: bRun,
      token_verifier: hash,
      result: passed,
      digest: "e".repeat(64),
    }),
    /no rows/,
  );
  await op("terminate", {
    batch_id: ab.id,
    status: "cancelled",
    error: "test",
  });
  await op("terminate", {
    batch_id: bb.id,
    status: "cancelled",
    error: "test",
  });
});
test("crashed workers expire and cancelled or revoked tokens cannot overwrite outcomes", async () => {
  const f = await fixture(),
    batch = await queued(f),
    hash = await claim(f, batch.id);
  const id = await scalar("select id from public.runs where batch_id=$1", [
    batch.id,
  ]);
  await db.query(
    "update public.execution_batches set deadline=now()-interval '1 second' where id=$1",
    [batch.id],
  );
  await op("expire");
  assert.equal(
    await scalar("select status from public.runs where id=$1", [id]),
    "timed_out",
  );
  await assert.rejects(
    op("complete", {
      batch_id: batch.id,
      run_id: id,
      token_verifier: hash,
      result: passed,
      digest: "f".repeat(64),
    }),
    /Invalid or expired/,
  );
  const next = await queued(f),
    nextHash = await claim(f, next.id);
  const nextId = await scalar("select id from public.runs where batch_id=$1", [
    next.id,
  ]);
  await op("revoke", f.args);
  await assert.rejects(
    op("start", {
      batch_id: next.id,
      run_id: nextId,
      token_verifier: nextHash,
    }),
    /Invalid or expired/,
  );
  assert.equal(
    await scalar("select status from public.execution_batches where id=$1", [
      next.id,
    ]),
    "cancelled",
  );
});
test("disabled and legacy journeys are not queued; incomplete passing results are rejected", async () => {
  const f = await fixture();
  await db.query("update public.journeys set configuration='{}' where id=$1", [
    f.journey,
  ]);
  await assert.rejects(queued(f), /unconfigured/);
  await db.query(
    "update public.journeys set configuration=$1,enabled=false where id=$2",
    [JSON.stringify(definition), f.journey],
  );
  await assert.rejects(queued(f), /disabled/);
  await db.query("update public.journeys set enabled=true where id=$1", [
    f.journey,
  ]);
  const batch = await queued(f),
    hash = await claim(f, batch.id),
    id = await scalar("select id from public.runs where batch_id=$1", [
      batch.id,
    ]);
  await op("start", { batch_id: batch.id, run_id: id, token_verifier: hash });
  await assert.rejects(
    op("complete", {
      batch_id: batch.id,
      run_id: id,
      token_verifier: hash,
      result: { ...passed, steps: [] },
      digest: "g".repeat(64),
    }),
    /incomplete steps/,
  );
  await op("terminate", {
    batch_id: batch.id,
    status: "error",
    error: "fixture worker interrupted",
  });
});
test("artifact paths, sizes, privacy and opt-in are enforced independently of browser sessions", async () => {
  const f = await fixture(),
    batch = await queued(f),
    hash = await claim(f, batch.id),
    id = await scalar("select id from public.runs where batch_id=$1", [
      batch.id,
    ]);
  const args = {
    batch_id: batch.id,
    run_id: id,
    token_verifier: hash,
    bytes: 100,
  };
  await assert.rejects(op("artifact", args), /capture is not enabled/);
  await db.query(
    "update public.runs set configuration=jsonb_set(configuration,'{definition,captureArtifacts}','true') where id=$1",
    [id],
  );
  await assert.rejects(
    op("artifact", { ...args, bytes: 2097153 }),
    /check constraint/,
  );
  const artifact = await op("artifact", args);
  assert.equal(artifact.path, `${aw}/${batch.id}/${id}/failure.png`);
  await service();
  assert.equal(
    await scalar(
      "select uploaded::text from public.run_artifacts where run_id=$1",
      [id],
    ),
    "false",
  );
  await user(bob);
  assert.equal(
    await scalar(
      "select count(*)::text from public.run_artifacts where run_id=$1",
      [id],
    ),
    "0",
  );
  await user(alice);
  assert.equal(
    await scalar(
      "select count(*)::text from public.run_artifacts where run_id=$1",
      [id],
    ),
    "1",
  );
  await assert.rejects(
    query("update public.run_artifacts set uploaded=true where run_id=$1", [
      id,
    ]),
    /permission denied/,
  );
  await op("terminate", {
    batch_id: batch.id,
    status: "cancelled",
    error: "test",
  });
});
test("repository revocation invalidates even an unexpired scoped token", async () => {
  const f = await fixture(),
    batch = await queued(f),
    hash = await claim(f, batch.id),
    id = await scalar("select id from public.runs where batch_id=$1", [
      batch.id,
    ]);
  await db.query(
    "update public.repositories set sync_status='removed' where id=$1",
    [f.repository],
  );
  await assert.rejects(
    op("start", { batch_id: batch.id, run_id: id, token_verifier: hash }),
    /Repository access revoked/,
  );
  await op("terminate", {
    batch_id: batch.id,
    status: "error",
    error: "Repository access revoked",
  });
});
test("workspace and runner request rate limits are bounded and cannot be bypassed by a different actor", async () => {
  const f = await fixture(bob, bw);
  await assert.rejects(
    op("queue", {
      ...f.args,
      actor_id: alice,
      request_id: randomUUID(),
      journey_ids: [f.journey],
    }),
    /Workspace permission denied/,
  );
  let limited = false;
  for (let i = 0; i < 11; i++) {
    try {
      const batch = await queued(f);
      await op("terminate", {
        batch_id: batch.id,
        status: "cancelled",
        error: "rate test",
      });
    } catch (error) {
      assert.match(String(error), /Workspace limit/);
      limited = true;
      break;
    }
  }
  assert.equal(limited, true);
  for (let i = 0; i < 600; i++) assert.equal((await op("gate")).allowed, true);
  assert.equal((await op("gate")).allowed, false);
});
