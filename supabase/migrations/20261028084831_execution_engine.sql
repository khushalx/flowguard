-- Legacy definitions retain their free text. Only validated v1 configuration is executable.
alter table public.journeys add column enabled boolean not null default true;
grant update (enabled) on public.journeys to authenticated;

create table public.execution_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  repository_id uuid references public.repositories(id) on delete set null,
  requested_by uuid not null references auth.users(id),
  request_id uuid not null,
  status text not null default 'queued' check (status in ('queued','running','passed','failed','error','timed_out','cancelled')),
  repository_name text not null, github_repository_id bigint not null, installation_id bigint not null,
  branch text not null, commit_sha text, github_run_id bigint, workflow_id bigint,
  trigger_type text not null default 'manual' check (trigger_type = 'manual'),
  error_message text, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  deadline timestamptz not null default now() + interval '30 minutes',
  last_reconciled_at timestamptz,
  unique(project_id,request_id)
);
create unique index execution_project_active on public.execution_batches(project_id) where status in ('queued','running');
create index execution_workspace_rate on public.execution_batches(workspace_id,created_at desc);
create index execution_deadlines on public.execution_batches(deadline) where status in ('queued','running');
alter table public.execution_batches enable row level security;
create policy batch_read on public.execution_batches for select to authenticated using(private.is_member(workspace_id));
revoke all on public.execution_batches from anon,authenticated;
grant select on public.execution_batches to authenticated;
grant all on public.execution_batches to service_role;

alter table public.runs drop constraint runs_status_check;
alter table public.runs add constraint runs_status_check check(status in ('unknown','queued','running','passed','failed','error','timed_out','cancelled'));
alter table public.runs add column batch_id uuid references public.execution_batches(id) on delete cascade;
alter table public.runs add column configuration jsonb;
alter table public.runs add column failure_category text check(failure_category in ('APPLICATION_FAILURE','SELECTOR_FAILURE','CONFIGURATION_ERROR','INFRASTRUCTURE_ERROR','TIMEOUT','CANCELLED'));
alter table public.runs add column error_message text;
alter table public.runs add column assertion jsonb;
alter table public.runs add column logs jsonb not null default '[]'::jsonb;
alter table public.runs add column result_digest text;
create index runs_batch_idx on public.runs(batch_id);

create table private.runner_credentials (
  project_id uuid primary key references public.projects(id) on delete cascade,
  repository_id uuid not null references public.repositories(id) on delete cascade,
  verifier text not null unique check(length(verifier)=64),
  created_at timestamptz not null default now(), revoked_at timestamptz
);
create table private.execution_tokens (
  batch_id uuid primary key references public.execution_batches(id) on delete cascade,
  project_id uuid not null references private.runner_credentials(project_id) on delete cascade,
  credential_verifier text not null,
  verifier text not null unique check(length(verifier)=64), expires_at timestamptz not null
);
create table private.engine_limits (
  key text primary key, window_start timestamptz not null, requests integer not null
);
alter table private.runner_credentials enable row level security;
alter table private.execution_tokens enable row level security;
alter table private.engine_limits enable row level security;
revoke all on private.runner_credentials,private.execution_tokens,private.engine_limits from public,anon,authenticated;
grant all on private.runner_credentials,private.execution_tokens,private.engine_limits to service_role;

create table public.run_artifacts (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.runs(id) on delete cascade,
  object_path text not null unique, kind text not null check(kind='screenshot'),
  bytes integer not null check(bytes between 1 and 2097152),
  uploaded boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '7 days',
  unique(run_id,kind)
);
alter table public.run_artifacts enable row level security;
create policy artifact_read on public.run_artifacts for select to authenticated using(exists(select 1 from public.runs r join public.projects p on p.id=r.project_id where r.id=run_id and private.is_member(p.workspace_id)));
revoke all on public.run_artifacts from public,anon,authenticated;
grant select on public.run_artifacts to authenticated;
grant all on public.run_artifacts to service_role;

-- Production has Storage; SQL-only fixtures deliberately do not. No public policies.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('flowguard-evidence','flowguard-evidence',false,2097152,array['image/png']) on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/png']$q$;
  end if;
end $$;

-- One service-only transactional boundary. Browser sessions cannot invoke it.
create function private.engine_operation(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  batch public.execution_batches; project public.projects; repository public.repositories;
  installation public.github_installations; credential private.runner_credentials;
  run public.runs; journey public.journeys; item jsonb; result jsonb;
  selected integer; pos integer; outcome text; limit_count integer;
begin
  if op='cleanup_list' then
    if to_regclass('storage.objects') is null then return jsonb_build_object('paths','[]'::jsonb); end if;
    execute $q$select jsonb_build_object('paths',coalesce(jsonb_agg(name),'[]'::jsonb)) from (select name from storage.objects where bucket_id='flowguard-evidence' and created_at<now()-interval '7 days' order by created_at limit 50) expired$q$ into result;
    return result;
  end if;
  if op='cleanup_delete' then
    delete from public.run_artifacts where expires_at<now();return jsonb_build_object('ok',true);
  end if;
  if op='gate' then
    insert into private.engine_limits as l values('runner',date_trunc('minute',now()),1)
    on conflict(key) do update set window_start=date_trunc('minute',now()),requests=case when l.window_start=date_trunc('minute',now()) then l.requests+1 else 1 end returning requests into limit_count;
    return jsonb_build_object('allowed',limit_count<=600);
  end if;
  if op='expire' then
    for batch in select * from public.execution_batches where status in ('queued','running') and deadline<now() for update skip locked loop
      update public.runs set status='timed_out',failure_category='TIMEOUT',error_message='Execution deadline expired before a complete result arrived.',completed_at=now() where batch_id=batch.id and status in ('queued','running');
      update public.execution_batches set status='timed_out',error_message='Execution deadline expired. Check GitHub Actions and retry.',completed_at=now() where id=batch.id;
      delete from private.execution_tokens where batch_id=batch.id;
    end loop;
    return jsonb_build_object('ok',true);
  end if;
  if op in ('credential','revoke','credential_status','queue') then
    select * into strict project from public.projects where id=(args->>'project_id')::uuid and workspace_id=(args->>'workspace_id')::uuid for update;
    if not exists(select 1 from public.workspace_members where workspace_id=project.workspace_id and user_id=(args->>'actor_id')::uuid and role=case when op in ('credential','revoke') then 'owner' else role end and role in ('owner','admin')) then raise exception 'Workspace permission denied' using errcode='42501'; end if;
    if op='credential_status' then return jsonb_build_object('configured',exists(select 1 from private.runner_credentials where project_id=project.id and revoked_at is null and created_at>now()-interval '90 days' and repository_id=project.repository_id)); end if;
    if project.repository_id is null then raise exception 'Connect a repository first'; end if;
    select * into strict repository from public.repositories where id=project.repository_id and workspace_id=project.workspace_id;
    if op in ('credential','revoke') then
      update private.runner_credentials set revoked_at=now() where project_id=project.id;
      update public.runs set status='cancelled',failure_category='CANCELLED',error_message='Runner credential was revoked or rotated.',completed_at=now() where batch_id in(select id from public.execution_batches where project_id=project.id and status in ('queued','running')) and status in ('queued','running');
      update public.execution_batches set status='cancelled',completed_at=now(),error_message='Runner credential was revoked or rotated.' where project_id=project.id and status in ('queued','running');
      delete from private.execution_tokens where project_id=project.id;
      if op='credential' then
        insert into private.runner_credentials(project_id,repository_id,verifier) values(project.id,repository.id,args->>'verifier') on conflict(project_id) do update set verifier=excluded.verifier,repository_id=excluded.repository_id,created_at=now(),revoked_at=null;
      end if;
      return jsonb_build_object('ok',true);
    end if;
    select * into batch from public.execution_batches where project_id=project.id and request_id=(args->>'request_id')::uuid;
    if found then return jsonb_build_object('id',batch.id,'duplicate',true); end if;
    if exists(select 1 from public.execution_batches where project_id=project.id and status in ('queued','running')) then raise exception 'A project execution is already active'; end if;
    perform 1 from public.workspaces where id=project.workspace_id for update;
    if (select count(*) from public.execution_batches where workspace_id=project.workspace_id and created_at>now()-interval '1 hour')>=10 then raise exception 'Workspace limit: 10 executions per hour'; end if;
    if not exists(select 1 from private.runner_credentials where project_id=project.id and repository_id=repository.id and revoked_at is null and created_at>now()-interval '90 days') then raise exception 'Configure a runner credential first'; end if;
    select * into strict installation from public.github_installations where id=repository.github_installation_id and workspace_id=project.workspace_id;
    if repository.sync_status<>'connected' or installation.installation_status<>'connected' then raise exception 'Repository access is unavailable'; end if;
    selected=jsonb_array_length(args->'journey_ids');
    if selected<1 or selected>5 then raise exception 'Select between 1 and 5 journeys'; end if;
    if selected<>(select count(*) from public.journeys where project_id=project.id and enabled and configuration->>'version'='1' and id in(select value::uuid from jsonb_array_elements_text(args->'journey_ids'))) then raise exception 'Selected journeys are disabled or unconfigured'; end if;
    insert into public.execution_batches(workspace_id,project_id,repository_id,requested_by,request_id,repository_name,github_repository_id,installation_id,branch,workflow_id)
    values(project.workspace_id,project.id,repository.id,(args->>'actor_id')::uuid,(args->>'request_id')::uuid,repository.full_name,repository.github_repository_id,installation.github_installation_id,repository.default_branch,(args->>'workflow_id')::bigint) returning * into batch;
    for journey in select * from public.journeys where project_id=project.id and id in(select value::uuid from jsonb_array_elements_text(args->'journey_ids')) order by created_at loop
      insert into public.runs(project_id,journey_id,journey_name,status,batch_id,branch,environment,browser,configuration)
      values(project.id,journey.id,journey.name,'queued',batch.id,batch.branch,project.target_url,'Chromium',jsonb_build_object('name',journey.name,'targetUrl',project.target_url,'startPath',journey.start_path,'definition',journey.configuration));
    end loop;
    return jsonb_build_object('id',batch.id,'duplicate',false);
  end if;
  select * into strict batch from public.execution_batches where id=(args->>'batch_id')::uuid for update;
  if op in ('dispatch','terminate','reconcile_lock') then
    if op='dispatch' then
      update public.execution_batches set github_run_id=coalesce(github_run_id,(args->>'github_run_id')::bigint) where id=batch.id;
    elsif op='reconcile_lock' then
      if batch.last_reconciled_at>now()-interval '30 seconds' then return jsonb_build_object('allowed',false); end if;
      update public.execution_batches set last_reconciled_at=now() where id=batch.id;
      return jsonb_build_object('allowed',true);
    elsif batch.status in ('queued','running') then
      outcome=args->>'status';if outcome not in ('error','timed_out','cancelled') then raise exception 'Invalid interruption status'; end if;
      update public.runs set status=outcome,failure_category=case outcome when 'cancelled' then 'CANCELLED' when 'timed_out' then 'TIMEOUT' else 'INFRASTRUCTURE_ERROR' end,error_message=left(args->>'error',2000),completed_at=now() where batch_id=batch.id and status in ('queued','running');
      update public.execution_batches set status=outcome,error_message=left(args->>'error',2000),completed_at=now() where id=batch.id;
      delete from private.execution_tokens where batch_id=batch.id;
    end if;
    return jsonb_build_object('ok',true);
  end if;
  if not exists(select 1 from public.repositories r join public.github_installations i on i.id=r.github_installation_id where r.id=batch.repository_id and r.workspace_id=batch.workspace_id and r.sync_status='connected' and i.installation_status='connected') then raise exception 'Repository access revoked' using errcode='42501'; end if;
  if op in ('claim_context','claim') then
    select * into credential from private.runner_credentials where project_id=batch.project_id and repository_id=batch.repository_id and verifier=args->>'credential_verifier' and revoked_at is null and created_at>now()-interval '90 days';
    if not found then raise exception 'Invalid runner credential' using errcode='42501'; end if;
    if batch.status<>'queued' or batch.deadline<now() then raise exception 'Execution cannot be claimed'; end if;
    if op='claim_context' then return jsonb_build_object('repository',batch.repository_name,'repositoryId',batch.github_repository_id,'installationId',batch.installation_id,'branch',batch.branch,'workflowId',batch.workflow_id,'githubRunId',batch.github_run_id); end if;
    if batch.github_run_id is not null and batch.github_run_id<>(args->>'github_run_id')::bigint then raise exception 'Workflow run mismatch' using errcode='42501'; end if;
    insert into private.execution_tokens(batch_id,project_id,credential_verifier,verifier,expires_at) values(batch.id,batch.project_id,credential.verifier,args->>'token_verifier',now()+interval '15 minutes');
    update public.execution_batches set status='running',started_at=now(),github_run_id=(args->>'github_run_id')::bigint,commit_sha=args->>'commit_sha',deadline=least(deadline,now()+interval '15 minutes') where id=batch.id;
    update public.runs set commit_sha=args->>'commit_sha' where batch_id=batch.id;
    select jsonb_agg(configuration||jsonb_build_object('runId',id) order by number) into result from public.runs where batch_id=batch.id;
    return jsonb_build_object('runs',result);
  end if;
  if not exists(select 1 from private.execution_tokens t join private.runner_credentials c on c.project_id=t.project_id where t.batch_id=batch.id and t.verifier=args->>'token_verifier' and t.expires_at>now() and c.verifier=t.credential_verifier and c.revoked_at is null) then raise exception 'Invalid or expired execution token' using errcode='42501'; end if;
  select * into strict run from public.runs where id=(args->>'run_id')::uuid and batch_id=batch.id for update;
  if op='start' then
    if batch.status<>'running' then raise exception 'Execution is no longer running'; end if;
    update public.runs set status='running',started_at=now() where id=run.id and status='queued';return jsonb_build_object('ok',true);
  end if;
  if op in ('artifact','artifact_confirm') then
    if run.configuration->'definition'->>'captureArtifacts'<>'true' or exists(select 1 from jsonb_array_elements(run.configuration->'definition'->'steps') s where s->'value' ? 'secret') then raise exception 'Artifact capture is not enabled'; end if;
    if batch.status not in ('running','failed','error','timed_out') then raise exception 'Artifact upload unavailable'; end if;
    insert into public.run_artifacts(run_id,object_path,kind,bytes) values(run.id,batch.workspace_id::text||'/'||batch.id::text||'/'||run.id::text||'/failure.png','screenshot',(args->>'bytes')::int) on conflict(run_id,kind) do nothing;
    if op='artifact_confirm' then update public.run_artifacts set uploaded=true where run_id=run.id and kind='screenshot'; end if;
    return (select jsonb_build_object('path',object_path) from public.run_artifacts where run_id=run.id and kind='screenshot');
  end if;
  if op<>'complete' then raise exception 'Unknown engine operation'; end if;
  if run.status not in ('running','queued') then
    if run.result_digest=args->>'digest' then return jsonb_build_object('duplicate',true); end if;
    raise exception 'Terminal results cannot be replaced';
  end if;
  if batch.status<>'running' or run.status<>'running' then raise exception 'Run has not started or execution ended'; end if;
  result=args->'result';outcome=result->>'status';
  if outcome not in ('passed','failed','error','timed_out','cancelled') then raise exception 'Invalid result'; end if;
  if outcome='passed' and (jsonb_array_length(result->'steps')<>jsonb_array_length(run.configuration->'definition'->'steps')+1 or exists(select 1 from jsonb_array_elements(result->'steps') s where s->>'status'<>'passed')) then raise exception 'Passing result has incomplete steps'; end if;
  update public.runs set status=outcome,completed_at=now(),duration_ms=(result->>'duration')::int,failure_category=result->>'failureCategory',error_message=result->>'error',assertion=result->'assertion',logs=result->'logs',result_digest=args->>'digest' where id=run.id;
  pos=0;for item in select value from jsonb_array_elements(result->'steps') loop
    pos=pos+1;insert into public.run_steps(run_id,sequence_number,name,status,error_message,metadata) values(run.id,pos,item->>'name',item->>'status',nullif(item->>'detail',''),jsonb_build_object('duration_ms',item->'duration','started_at',item->'startedAt'));
  end loop;
  if not exists(select 1 from public.runs where batch_id=batch.id and status in ('queued','running')) then
    select case when bool_or(status='error') then 'error' when bool_or(status='timed_out') then 'timed_out' when bool_or(status='failed') then 'failed' when bool_or(status='cancelled') then 'cancelled' else 'passed' end into outcome from public.runs where batch_id=batch.id;
    update public.execution_batches set status=outcome,completed_at=now() where id=batch.id;
  end if;
  return jsonb_build_object('duplicate',false);
end $$;
revoke all on function private.engine_operation(text,jsonb) from public,anon,authenticated;
grant execute on function private.engine_operation(text,jsonb) to service_role;
create function public.engine_operation(op text,args jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.engine_operation(op,args)$$;
revoke all on function public.engine_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.engine_operation(text,jsonb) to service_role;
