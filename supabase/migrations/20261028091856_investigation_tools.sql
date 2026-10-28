-- Additive investigation features. Existing engine remains the execution boundary.
alter table public.runs add column verification_of uuid references public.runs(id) on delete set null;
create index runs_verification_idx on public.runs(verification_of) where verification_of is not null;
create index runs_journey_history on public.runs(project_id,journey_id,started_at desc,id desc);

-- Queue original immutable behavior in the same transaction as the existing engine.
alter function private.engine_operation(text,jsonb) rename to engine_operation_v1;
create function private.engine_operation(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.runs; result jsonb;
begin
  if op='queue' and args ? 'source_run_id' then
    select r.* into strict source from public.runs r join public.projects p on p.id=r.project_id
      where r.id=(args->>'source_run_id')::uuid and r.project_id=(args->>'project_id')::uuid and p.workspace_id=(args->>'workspace_id')::uuid;
    if source.status not in ('failed','error','timed_out','cancelled') or source.configuration is null or source.journey_id is null or coalesce(source.configuration->'definition'->>'version','')<>'1' then raise exception 'Verification requires an unsuccessful saved check'; end if;
    if args->'journey_ids' <> jsonb_build_array(source.journey_id::text) then raise exception 'Verification journey mismatch' using errcode='42501'; end if;
    result=private.engine_operation_v1(op,args);
    if not coalesce((result->>'duplicate')::boolean,false) then
      update public.runs set configuration=jsonb_set(source.configuration,'{targetUrl}',to_jsonb(coalesce(args->>'target_url',source.configuration->>'targetUrl'))),
        environment=coalesce(args->>'target_url',source.configuration->>'targetUrl'),journey_name=source.journey_name,verification_of=source.id
        where batch_id=(result->>'id')::uuid;
    end if;
    return result;
  end if;
  return private.engine_operation_v1(op,args);
end $$;
revoke all on function private.engine_operation(text,jsonb),private.engine_operation_v1(text,jsonb) from public,anon,authenticated;
grant execute on function private.engine_operation(text,jsonb),private.engine_operation_v1(text,jsonb) to service_role;
-- Recompile SQL wrapper so it resolves the new function, not the renamed OID.
create or replace function public.engine_operation(op text,args jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.engine_operation(op,args)$$;

create table public.failure_analyses (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 run_id uuid not null references public.runs(id) on delete cascade, evidence_hash text not null, model text not null,
 status text not null check(status in ('pending','complete','error')), output jsonb,
 input_tokens integer, output_tokens integer, estimated_usd numeric, reserved_usd numeric not null,
 created_at timestamptz not null default now(), completed_at timestamptz, error_code text,
 unique(run_id,evidence_hash,model)
);
alter table public.failure_analyses enable row level security;
create policy analysis_read on public.failure_analyses for select to authenticated using(private.is_member(workspace_id));
revoke all on public.failure_analyses from public,anon,authenticated;
grant select on public.failure_analyses to authenticated;
grant all on public.failure_analyses to service_role;
create index analysis_workspace_usage on public.failure_analyses(workspace_id,created_at desc);

create function private.investigation_operation(op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare wid uuid; current_analysis public.failure_analyses; quota integer;
begin
 select p.workspace_id into strict wid from public.runs r join public.projects p on p.id=r.project_id where r.id=(args->>'run_id')::uuid;
 if wid<>(args->>'workspace_id')::uuid or not exists(select 1 from public.workspace_members where workspace_id=wid and user_id=(args->>'actor_id')::uuid and role in ('owner','admin')) then raise exception 'Workspace permission denied' using errcode='42501'; end if;
 perform 1 from public.workspaces where id=wid for update;
 if op='reserve' then
   select * into current_analysis from public.failure_analyses where run_id=(args->>'run_id')::uuid and evidence_hash=args->>'evidence_hash' and model=args->>'model';
   if found then return to_jsonb(current_analysis)||jsonb_build_object('cached',true); end if;
   if not exists(select 1 from public.runs where id=(args->>'run_id')::uuid and status in ('failed','error','timed_out','cancelled')) then raise exception 'Analysis requires an unsuccessful completed run'; end if;
   select count(*) into quota from public.failure_analyses where workspace_id=wid and created_at>now()-interval '1 minute';
   if quota>=5 then raise exception 'Analysis rate limit reached' using errcode='P0001'; end if;
   select count(*) into quota from public.failure_analyses where workspace_id=wid and created_at>=date_trunc('day',now(),'UTC');
   if quota>=20 or (select coalesce(sum(reserved_usd),0) from public.failure_analyses where workspace_id=wid and created_at>=date_trunc('day',now(),'UTC')) + (args->>'reserved_usd')::numeric > 1 then raise exception 'Daily analysis quota reached' using errcode='P0001'; end if;
   if (args->>'reserved_usd')::numeric not between 0.000001 and 1 then raise exception 'Invalid analysis budget'; end if;
   insert into public.failure_analyses(workspace_id,run_id,evidence_hash,model,status,reserved_usd) values(wid,(args->>'run_id')::uuid,args->>'evidence_hash',args->>'model','pending',(args->>'reserved_usd')::numeric) returning * into current_analysis;
   return to_jsonb(current_analysis)||jsonb_build_object('cached',false);
 elsif op='finish' then
   update public.failure_analyses set status=case when args->'output' is null or args->'output'='null'::jsonb then 'error' else 'complete' end,
     output=args->'output',input_tokens=(args->>'input_tokens')::integer,output_tokens=(args->>'output_tokens')::integer,estimated_usd=(args->>'estimated_usd')::numeric,error_code=args->>'error_code',completed_at=now()
     where id=(args->>'id')::uuid and workspace_id=wid and run_id=(args->>'run_id')::uuid and status='pending';
   return jsonb_build_object('ok',true);
 end if;
 raise exception 'Unknown investigation operation';
end $$;
revoke all on function private.investigation_operation(text,jsonb) from public,anon,authenticated;
grant execute on function private.investigation_operation(text,jsonb) to service_role;
create function public.investigation_operation(op text,args jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.investigation_operation(op,args)$$;
revoke all on function public.investigation_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.investigation_operation(text,jsonb) to service_role;

create table public.notification_preferences (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 in_app boolean not null default true, primary key(workspace_id,user_id)
);
alter table public.notification_preferences enable row level security;
create policy preferences_own on public.notification_preferences for all to authenticated using(user_id=(select auth.uid()) and private.is_member(workspace_id)) with check(user_id=(select auth.uid()) and private.is_member(workspace_id));
revoke all on public.notification_preferences from public,anon,authenticated;
grant select,insert,update on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
create table public.workspace_events (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 run_id uuid not null references public.runs(id) on delete cascade,
 kind text not null check(kind in ('new_failure','repeated_failure','regression_resolved','runner_configuration_problem')),
 created_at timestamptz not null default now(), unique(run_id,kind)
);
alter table public.workspace_events enable row level security;
create policy events_read on public.workspace_events for select to authenticated using(private.is_member(workspace_id));
revoke all on public.workspace_events from public,anon,authenticated;
grant select on public.workspace_events to authenticated;
grant all on public.workspace_events to service_role;
create index events_workspace_recent on public.workspace_events(workspace_id,created_at desc);
-- Event payloads contain identifiers only. No page content or credentials, no outbound delivery.
create function private.record_run_event() returns trigger language plpgsql security definer set search_path='' as $$
declare wid uuid; kind text; original public.runs;
begin
 if new.status=old.status or new.status not in ('passed','failed','error','timed_out','cancelled') then return new; end if;
 select workspace_id into wid from public.projects where id=new.project_id;
 if new.status='passed' then
   if new.verification_of is null then return new; end if;
   select * into original from public.runs where id=new.verification_of and project_id=new.project_id;
   if original.status<>'failed' or original.failure_category<>'APPLICATION_FAILURE' or original.assertion is null or original.configuration is distinct from new.configuration or original.branch is distinct from new.branch or original.browser is distinct from new.browser then return new; end if;
   if original.batch_id is null or new.batch_id is null or (select repository_name from public.execution_batches where id=original.batch_id) is distinct from (select repository_name from public.execution_batches where id=new.batch_id) then return new; end if;
   -- Protected credential values can rotate independently of saved references.
   if exists(select 1 from jsonb_array_elements(new.configuration->'definition'->'steps') s where s->>'action'='fill' and s->'value' ? 'secret') then return new; end if;
   if (select count(*) from public.run_steps where run_id=new.id and status='passed') <> jsonb_array_length(new.configuration->'definition'->'steps')+1 then return new; end if;
   if not exists(select 1 from public.run_steps old_step join public.run_steps new_step on new_step.run_id=new.id and new_step.sequence_number=old_step.sequence_number and new_step.name=old_step.name and new_step.status='passed' where old_step.run_id=original.id and old_step.status='failed' and old_step.name like 'assert%') then return new; end if;
   kind='regression_resolved';
 elsif new.failure_category in ('CONFIGURATION_ERROR','INFRASTRUCTURE_ERROR') then kind='runner_configuration_problem';
 else
   kind='new_failure';
   if new.assertion is not null and new.configuration is not null and exists(select 1 from public.runs r where r.id<>new.id and r.project_id=new.project_id and r.journey_id=new.journey_id and r.status=new.status and r.failure_category=new.failure_category and r.configuration=new.configuration and r.branch=new.branch and r.browser=new.browser and r.error_message=new.error_message and r.assertion=new.assertion) then kind='repeated_failure'; end if;
 end if;
 insert into public.workspace_events(workspace_id,run_id,kind) values(wid,new.id,kind) on conflict do nothing;
 return new;
end $$;
revoke all on function private.record_run_event() from public,anon,authenticated;
create constraint trigger run_events after update on public.runs deferrable initially deferred for each row execute function private.record_run_event();

create table public.run_issue_links (
 run_id uuid primary key references public.runs(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 issue_url text, created_at timestamptz not null default now()
);
alter table public.run_issue_links enable row level security;
create policy issue_read on public.run_issue_links for select to authenticated using(private.is_member(workspace_id));
revoke all on public.run_issue_links from public,anon,authenticated;
grant select on public.run_issue_links to authenticated;
grant all on public.run_issue_links to service_role;
create index issue_workspace_idx on public.run_issue_links(workspace_id);
