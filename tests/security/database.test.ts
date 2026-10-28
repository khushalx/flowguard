import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Actual PostgreSQL engine, not a policy-text mock. Only Supabase's Auth schema
// and JWT role plumbing are stubbed; the application migration runs unchanged.
const db = new PGlite();
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const eve = "00000000-0000-4000-8000-000000000003";
let aw: string,
  bw: string,
  ap: string,
  bp: string,
  aj: string,
  run: string,
  install: string,
  repo: string;
async function asUser(id: string) {
  await db.exec(
    `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
}
async function root() {
  await db.exec("reset role");
}
async function scalar(sql: string) {
  return Object.values((await db.query(sql)).rows[0] as object)[0] as string;
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table auth.identities(user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;
    insert into auth.users values('${alice}'),('${bob}'),('${eve}');
    insert into auth.identities values('${alice}','github','1001','{"user_name":"alice","full_name":"Alice"}'),('${bob}','github','1002','{"user_name":"bob"}');`);
  await db.exec("create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin return; end; $$");
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  await asUser(alice);
  aw = await scalar("select public.bootstrap_workspace()");
  ap = await scalar(
    `insert into public.projects(workspace_id,name,target_url) values('${aw}','Alice app','https://alice.example.com') returning id`,
  );
  aj = await scalar(
    `insert into public.journeys(project_id,name,start_path,success_condition) values('${ap}','Login','/login','Dashboard visible') returning id`,
  );
  await asUser(bob);
  bw = await scalar("select public.bootstrap_workspace()");
  bp = await scalar(
    `insert into public.projects(workspace_id,name,target_url) values('${bw}','Bob app','https://bob.example.com') returning id`,
  );
  await root();
  run = await scalar(
    `insert into public.runs(project_id,journey_id,journey_name,status) values('${ap}','${aj}','Login','unknown') returning id`,
  );
  await db.exec(
    `insert into public.run_steps(run_id,sequence_number,name,status) values('${run}',1,'Open page','skipped')`,
  );
  install = await scalar(
    `insert into public.github_installations(workspace_id,github_installation_id,github_account_id,github_account_login,account_type,installation_status) values('${aw}',123,1001,'alice','User','connected') returning id`,
  );
  await db.exec(
    `select public.sync_installation_repositories('${install}','[{"id":456,"owner":"alice","name":"app","fullName":"alice/app","defaultBranch":"main","private":true,"htmlUrl":"https://github.com/alice/app"}]')`,
  );
  repo = await scalar(
    `select id from public.repositories where github_repository_id=456`,
  );
});
after(async () => {
  await db.close();
});

test("bootstrap is idempotent and requires a trusted GitHub identity", async () => {
  await asUser(alice);
  assert.equal(await scalar("select public.bootstrap_workspace()"), aw);
  assert.equal(
    await scalar("select count(*)::text from public.workspaces"),
    "1",
  );
  await asUser(eve);
  await assert.rejects(
    db.query("select public.bootstrap_workspace()"),
    /Verified GitHub identity/,
  );
});
test("workspace context is read-only, RLS-bound and unavailable to anonymous callers", async () => {
  await asUser(alice);
  const before = await scalar(
    `select updated_at::text from public.profiles where id='${alice}'`,
  );
  for (let i = 0; i < 3; i++) {
    const result = await db.query<{ id: string; role: string }>(
      "select * from public.workspace_context()",
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].id, aw);
    assert.equal(result.rows[0].role, "owner");
  }
  assert.equal(
    await scalar(
      `select updated_at::text from public.profiles where id='${alice}'`,
    ),
    before,
  );
  assert.equal(
    await scalar(
      `select count(*)::text from public.latest_workspace_runs('${bw}')`,
    ),
    "0",
  );
  await asUser(bob);
  assert.equal(await scalar("select id from public.workspace_context()"), bw);
  await root();
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select * from public.workspace_context()"),
    /permission denied/,
  );
});
test("optional hosted auto-RLS helper stays outside the client RPC privileges",async()=>{
  await root();
  for(const role of ["anon","authenticated"])
    assert.equal(await scalar(`select has_function_privilege('${role}','public.rls_auto_enable()','execute')`),false);
});
test("profiles are private; verified GitHub ID and owner identity are immutable", async () => {
  await asUser(alice);
  assert.equal(
    await scalar(
      `select count(*)::text from public.profiles where id='${bob}'`,
    ),
    "0",
  );
  await db.exec(
    `update public.profiles set full_name='Alice updated' where id='${alice}'`,
  );
  await assert.rejects(
    db.query(
      `update public.profiles set github_user_id=1002 where id='${alice}'`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query(`update public.workspaces set owner_id='${bob}' where id='${aw}'`),
    /permission denied/,
  );
});
test("cross-workspace reads cannot expose projects, journeys, runs, steps, repositories or installations", async () => {
  await asUser(bob);
  for (const [table, where] of [
    ["projects", `id='${ap}'`],
    ["journeys", `id='${aj}'`],
    ["runs", `id='${run}'`],
    ["run_steps", `run_id='${run}'`],
    ["repositories", `id='${repo}'`],
    ["github_installations", `id='${install}'`],
  ])
    assert.equal(
      await scalar(`select count(*)::text from public.${table} where ${where}`),
      "0",
      table,
    );
});
test("cross-workspace inserts, moves, updates and deletes are denied", async () => {
  await asUser(bob);
  await assert.rejects(
    db.query(
      `insert into public.projects(workspace_id,name,target_url) values('${aw}','Attack','https://evil.example.com')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.query(
      `insert into public.journeys(project_id,name,start_path,success_condition) values('${ap}','Attack','/','x')`,
    ),
    /row-level security/,
  );
  assert.equal(
    (
      await db.query(
        `update public.projects set name='Attack' where id='${ap}' returning id`,
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        `delete from public.projects where id='${ap}' returning id`,
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      `update public.projects set workspace_id='${aw}' where id='${bp}'`,
    ),
    /permission denied/,
  );
});
test("users cannot join other workspaces, promote roles, or write installation/run data", async () => {
  await asUser(bob);
  await assert.rejects(
    db.query(
      `insert into public.workspace_members(workspace_id,user_id,role) values('${aw}','${bob}','owner')`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query(`update public.workspace_members set role='owner'`),
    /permission denied/,
  );
  await assert.rejects(
    db.query(`update public.github_installations set workspace_id='${bw}'`),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      `insert into public.runs(project_id,journey_name,status) values('${bp}','Fake success','passed')`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query(`delete from public.run_steps`),
    /permission denied/,
  );
});
test("read-only members cannot mutate; admins can edit; neither can grant roles", async () => {
  await root();
  await db.exec(
    `insert into public.workspace_members(workspace_id,user_id,role) values('${aw}','${eve}','member')`,
  );
  await asUser(eve);
  assert.equal(
    await scalar(`select count(*)::text from public.projects where id='${ap}'`),
    "1",
  );
  await assert.rejects(
    db.query(
      `insert into public.projects(workspace_id,name,target_url) values('${aw}','Member write','https://example.com')`,
    ),
    /row-level security/,
  );
  await root();
  await db.exec(
    `update public.workspace_members set role='admin' where workspace_id='${aw}' and user_id='${eve}'`,
  );
  await asUser(eve);
  await db.exec(
    `update public.projects set description='Admin edit' where id='${ap}'`,
  );
  await assert.rejects(
    db.query(
      `update public.workspace_members set role='owner' where user_id='${eve}'`,
    ),
    /permission denied/,
  );
  await root();
  await db.exec(`delete from public.workspace_members where user_id='${eve}'`);
});
test("repository linking requires the same workspace and current connected status", async () => {
  await asUser(bob);
  await assert.rejects(
    db.query(
      `update public.projects set repository_id='${repo}' where id='${bp}'`,
    ),
    /row-level security/,
  );
  await asUser(alice);
  await db.exec(
    `update public.projects set repository_id='${repo}' where id='${ap}'`,
  );
  await root();
  await db.exec(
    `update public.repositories set sync_status='removed' where id='${repo}'`,
  );
  await asUser(alice);
  await assert.rejects(
    db.query(
      `update public.projects set repository_id='${repo}' where id='${ap}'`,
    ),
    /row-level security/,
  );
  await db.exec(
    `update public.projects set repository_id=null where id='${ap}'`,
  );
});
test("private states and privileged RPCs are inaccessible to authenticated users and anon", async () => {
  await asUser(alice);
  await assert.rejects(
    db.query("select * from private.installation_states"),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      `select public.issue_installation_state('x','${alice}','${aw}','/app')`,
    ),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      `select public.apply_github_webhook(gen_random_uuid(),'ping','{}')`,
    ),
    /permission denied/,
  );
  await root();
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select * from public.projects"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.bootstrap_workspace()"),
    /permission denied/,
  );
});
test("installation state is bound to a user, expires, and is consumed only once", async () => {
  await root();
  await db.exec("set role service_role");
  await db.exec(
    `select public.issue_installation_state('hash','${alice}','${aw}','/app/projects/new')`,
  );
  assert.equal(
    (
      await db.query(
        `select * from public.consume_installation_state('hash','${bob}')`,
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        `select * from public.consume_installation_state('hash','${alice}')`,
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        `select * from public.consume_installation_state('hash','${alice}')`,
      )
    ).rows.length,
    0,
  );
  await db.exec(
    `select public.issue_installation_state('expired','${alice}','${aw}','/app');update private.installation_states set expires_at=now()-interval '1 second' where token_hash='expired'`,
  );
  assert.equal(
    (
      await db.query(
        `select * from public.consume_installation_state('expired','${alice}')`,
      )
    ).rows.length,
    0,
  );
});
test("repository lifecycle webhooks invalidate removed access and request a live refresh for additions", async () => {
  await root();
  await db.exec("set role service_role");
  await db.exec(
    `select public.apply_github_webhook(gen_random_uuid(),'installation_repositories','{"action":"removed","installation":{"id":123},"repositories_removed":[{"id":456}]}')`,
  );
  assert.equal(
    await scalar(
      `select sync_status from public.repositories where id='${repo}'`,
    ),
    "removed",
  );
  await db.exec(
    `select public.apply_github_webhook(gen_random_uuid(),'installation_repositories','{"action":"added","installation":{"id":123}}')`,
  );
  assert.equal(
    await scalar(
      `select needs_sync from public.github_installations where id='${install}'`,
    ),
    true,
  );
  await db.exec(
    `select public.sync_installation_repositories('${install}','[{"id":456,"owner":"alice","name":"app","fullName":"alice/app","defaultBranch":"main","private":true,"htmlUrl":"https://github.com/alice/app"}]')`,
  );
  assert.equal(
    await scalar(
      `select needs_sync from public.github_installations where id='${install}'`,
    ),
    false,
  );
  assert.equal(
    await scalar(
      `select sync_status from public.repositories where id='${repo}'`,
    ),
    "connected",
  );
});
test("webhook effects are atomic and replay-safe; removals cannot be undone by stale events", async () => {
  await root();
  await db.exec("set role service_role");
  const delivery = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    await scalar(
      `select public.apply_github_webhook('${delivery}','installation','{"action":"deleted","installation":{"id":123}}')`,
    ),
    true,
  );
  assert.equal(
    await scalar(
      `select public.apply_github_webhook('${delivery}','installation','{"action":"deleted","installation":{"id":123}}')`,
    ),
    false,
  );
  assert.equal(
    await scalar(
      `select installation_status from public.github_installations where id='${install}'`,
    ),
    "removed",
  );
  await db.exec(
    `select public.apply_github_webhook(gen_random_uuid(),'installation','{"action":"created","installation":{"id":123}}')`,
  );
  assert.equal(
    await scalar(
      `select installation_status from public.github_installations where id='${install}'`,
    ),
    "removed",
  );
  await assert.rejects(
    db.query(`select public.sync_installation_repositories('${install}','[]')`),
    /not connected/,
  );
});
test("explicit local import is idempotent, excludes runs and preserves local journey relationships", async () => {
  await asUser(bob);
  const call = `select public.import_local_workspace('[{"source_id":"local-1","name":"Imported app","target_url":"https://import.example.com","description":"User data"}]','[{"source_id":"local-journey","project_source_id":"local-1","name":"Checkout","start_path":"/checkout","success_condition":"Confirmation"}]')`;
  await db.exec(call);
  await db.exec(call);
  assert.equal(
    await scalar(
      `select count(*)::text from public.projects where workspace_id='${bw}' and name='Imported app'`,
    ),
    "1",
  );
  assert.equal(
    await scalar(
      `select count(*)::text from public.journeys where name='Checkout'`,
    ),
    "1",
  );
  assert.equal(await scalar(`select count(*)::text from public.runs`), "0");
});
test("journey deletion preserves runs; project deletion cascades within its workspace", async () => {
  await asUser(alice);
  await db.exec(`delete from public.journeys where id='${aj}'`);
  assert.equal(
    await scalar(
      `select count(*)::text from public.runs where id='${run}' and journey_id is null`,
    ),
    "1",
  );
  await db.exec(`delete from public.projects where id='${ap}'`);
  assert.equal(
    await scalar(`select count(*)::text from public.runs where id='${run}'`),
    "0",
  );
  await asUser(bob);
  assert.equal(
    await scalar(`select count(*)::text from public.projects where id='${bp}'`),
    "1",
  );
});
