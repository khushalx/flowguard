begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint unique,
  username text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  slug text not null unique,
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, workspace_id);
create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_installation_id bigint not null unique,
  github_account_id bigint not null,
  github_account_login text not null,
  account_type text not null check (account_type = 'User'),
  needs_sync boolean not null default false,
  installation_status text not null check (installation_status in ('connected', 'removed', 'access_required', 'sync_failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index github_installations_workspace_idx on public.github_installations(workspace_id);
create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  github_repository_id bigint not null unique,
  github_installation_id uuid not null,
  owner_login text not null,
  name text not null,
  full_name text not null,
  default_branch text not null,
  is_private boolean not null,
  html_url text not null,
  sync_status text not null check (sync_status in ('connected', 'removed', 'access_required', 'sync_failed')),
  updated_at timestamptz not null default now(),
  foreign key (github_installation_id, workspace_id) references public.github_installations(id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);
create index repositories_installation_idx on public.repositories(github_installation_id);
create index repositories_workspace_idx on public.repositories(workspace_id);
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  repository_id uuid,
  name text not null check (length(name) between 1 and 80),
  target_url text not null check (length(target_url) <= 2000 and target_url ~ '^https?://'),
  description text not null default '' check (length(description) <= 240),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id, workspace_id) references public.repositories(id, workspace_id),
  unique (workspace_id, target_url, name)
);
create index projects_workspace_idx on public.projects(workspace_id, created_at desc);
create index projects_repository_idx on public.projects(repository_id);
create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  start_path text not null check (length(start_path) between 1 and 500),
  success_condition text not null check (length(success_condition) between 1 and 500),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index journeys_project_idx on public.journeys(project_id);
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  project_id uuid not null references public.projects(id) on delete cascade,
  journey_id uuid references public.journeys(id) on delete set null,
  journey_name text not null,
  status text not null check (status in ('passed', 'failed', 'running', 'unknown')),
  commit_sha text,
  branch text,
  commit_message text,
  environment text,
  browser text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms >= 0),
  created_at timestamptz not null default now()
);
create index runs_project_idx on public.runs(project_id, started_at desc);
create index runs_journey_idx on public.runs(journey_id);
create table public.run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  name text not null,
  status text not null check (status in ('passed', 'failed', 'running', 'skipped')),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  unique (run_id, sequence_number)
);

create table private.installation_states (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index installation_states_expiry_idx on private.installation_states(expires_at);
create table private.webhook_deliveries (
  delivery_id uuid primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
do $$ declare tab text; begin
  foreach tab in array array['profiles','workspaces','github_installations','repositories','projects','journeys'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()', tab);
  end loop;
end $$;

-- No definer is needed for membership checks: the member policy exposes only
-- the caller's own membership rows and does not recurse into these helpers.
create function private.is_member(wid uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = (select auth.uid()));
$$;
create function private.can_edit(wid uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id = wid and m.user_id = (select auth.uid()) and m.role in ('owner','admin'));
$$;

-- The single authenticated definer operation is needed to atomically create
-- initial membership, which users otherwise cannot write. No caller arguments,
-- pinned search_path, explicit auth identity, and trusted auth.identities only.
create function private.bootstrap_workspace() returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); gid text; identity_data jsonb; wid uuid;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select i.provider_id, i.identity_data into gid, identity_data from auth.identities i where i.user_id = uid and i.provider = 'github' limit 1;
  if gid is null or gid !~ '^[0-9]+$' then raise exception 'Verified GitHub identity required' using errcode = '42501'; end if;
  insert into public.profiles (id, github_user_id, username, full_name, avatar_url)
  values (uid, gid::bigint, identity_data->>'user_name', coalesce(identity_data->>'full_name', identity_data->>'name'), identity_data->>'avatar_url')
  on conflict (id) do update set github_user_id = excluded.github_user_id;
  insert into public.workspaces (name, slug, owner_id) values ('Personal workspace', 'personal-' || uid::text, uid)
  on conflict (owner_id) do nothing;
  select id into wid from public.workspaces where owner_id = uid;
  insert into public.workspace_members (workspace_id, user_id, role) values (wid, uid, 'owner') on conflict do nothing;
  return wid;
end;
$$;
create function public.bootstrap_workspace() returns uuid language sql security invoker set search_path = '' as $$ select private.bootstrap_workspace(); $$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.github_installations enable row level security;
alter table public.repositories enable row level security;
alter table public.projects enable row level security;
alter table public.journeys enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table private.installation_states enable row level security;
alter table private.webhook_deliveries enable row level security;

create policy own_profile_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy member_workspace_read on public.workspaces for select to authenticated using (private.is_member(id));
create policy owner_workspace_update on public.workspaces for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy own_membership_read on public.workspace_members for select to authenticated using (user_id = (select auth.uid()));
create policy installation_read on public.github_installations for select to authenticated using (private.is_member(workspace_id));
create policy repository_read on public.repositories for select to authenticated using (private.is_member(workspace_id));
create policy project_read on public.projects for select to authenticated using (private.is_member(workspace_id));
create policy project_create on public.projects for insert to authenticated with check (
  private.can_edit(workspace_id) and (repository_id is null or exists (
    select 1 from public.repositories r join public.github_installations i on i.id = r.github_installation_id
    where r.id = repository_id and r.workspace_id = projects.workspace_id and r.sync_status = 'connected' and i.installation_status = 'connected'
  ))
);
create policy project_update on public.projects for update to authenticated using (private.can_edit(workspace_id)) with check (
  private.can_edit(workspace_id) and (repository_id is null or exists (
    select 1 from public.repositories r join public.github_installations i on i.id = r.github_installation_id
    where r.id = repository_id and r.workspace_id = projects.workspace_id and r.sync_status = 'connected' and i.installation_status = 'connected'
  ))
);
create policy project_delete on public.projects for delete to authenticated using (private.can_edit(workspace_id));
create policy journey_read on public.journeys for select to authenticated using (exists(select 1 from public.projects p where p.id = project_id and private.is_member(p.workspace_id)));
create policy journey_create on public.journeys for insert to authenticated with check (exists(select 1 from public.projects p where p.id = project_id and private.can_edit(p.workspace_id)));
create policy journey_update on public.journeys for update to authenticated using (exists(select 1 from public.projects p where p.id = project_id and private.can_edit(p.workspace_id))) with check (exists(select 1 from public.projects p where p.id = project_id and private.can_edit(p.workspace_id)));
create policy journey_delete on public.journeys for delete to authenticated using (exists(select 1 from public.projects p where p.id = project_id and private.can_edit(p.workspace_id)));
create policy run_read on public.runs for select to authenticated using (exists(select 1 from public.projects p where p.id = project_id and private.is_member(p.workspace_id)));
create policy step_read on public.run_steps for select to authenticated using (exists(select 1 from public.runs r join public.projects p on p.id = r.project_id where r.id = run_id and private.is_member(p.workspace_id)));

-- Explicit grants: no public/anon access, no client writes to installation,
-- membership or execution tables, and no profile GitHub-ID/owner-ID changes.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.workspaces, public.workspace_members, public.github_installations, public.repositories, public.projects, public.journeys, public.runs, public.run_steps to authenticated;
grant update (username, full_name, avatar_url) on public.profiles to authenticated;
grant update (name) on public.workspaces to authenticated;
grant insert, delete on public.projects, public.journeys to authenticated;
grant update (name, target_url, description, repository_id, status) on public.projects to authenticated;
grant update (name, start_path, success_condition, configuration) on public.journeys to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.bootstrap_workspace() from public, anon;
grant execute on function private.is_member(uuid), private.can_edit(uuid), private.bootstrap_workspace() to authenticated;
grant execute on function public.bootstrap_workspace() to authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Service-only RPCs keep private tables out of the Data API. All inputs are
-- constructed by authenticated server routes or a signature-verified webhook.
create function private.issue_installation_state(token_hash text, user_id uuid, workspace_id uuid, return_to text) returns void language sql security definer set search_path = '' as $$
  delete from private.installation_states where expires_at < now();
  insert into private.installation_states(token_hash, user_id, workspace_id, return_to, expires_at) values(token_hash, user_id, workspace_id, return_to, now() + interval '10 minutes');
$$;
create function private.consume_installation_state(hash text, uid uuid) returns table(workspace_id uuid, return_to text) language sql security definer set search_path = '' as $$
  delete from private.installation_states where token_hash = hash and user_id = uid and expires_at > now() returning workspace_id, return_to;
$$;

-- Atomic repository snapshots: an API failure never removes existing access.
-- Serializes with webhook delivery processing on the installation row.
create function private.sync_installation_repositories(iid uuid, repos jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare inst public.github_installations; repo jsonb;
begin
  select * into strict inst from public.github_installations where id = iid for update;
  if inst.installation_status <> 'connected' then raise exception 'Installation is not connected'; end if;
  update public.repositories set sync_status = 'removed' where github_installation_id = iid;
  for repo in select * from jsonb_array_elements(repos) loop
    insert into public.repositories(workspace_id, github_repository_id, github_installation_id, owner_login, name, full_name, default_branch, is_private, html_url, sync_status)
    values(inst.workspace_id, (repo->>'id')::bigint, iid, repo->>'owner', repo->>'name', repo->>'fullName', repo->>'defaultBranch', (repo->>'private')::boolean, repo->>'htmlUrl', 'connected')
    on conflict (github_repository_id) do update set github_installation_id = excluded.github_installation_id, owner_login = excluded.owner_login, name = excluded.name, full_name = excluded.full_name, default_branch = excluded.default_branch, is_private = excluded.is_private, html_url = excluded.html_url, sync_status = 'connected'
    where public.repositories.workspace_id = excluded.workspace_id;
  end loop;
  update public.github_installations set needs_sync = false where id = iid;
end;
$$;

-- Delivery claim and changes share one transaction, so failed deliveries can
-- be retried, duplicate deliveries are harmless, and stale events cannot
-- resurrect a deleted installation. Reconnection requires fresh verification.
create function private.apply_github_webhook(delivery uuid, event text, payload jsonb) returns boolean language plpgsql security definer set search_path = '' as $$
declare iid uuid; action text := payload->>'action';
begin
  insert into private.webhook_deliveries(delivery_id, event_type) values(delivery, event) on conflict do nothing;
  if not found then return false; end if;
  select id into iid from public.github_installations where github_installation_id = (payload#>>'{installation,id}')::bigint for update;
  if iid is null then return true; end if;
  if event = 'installation' and action in ('deleted', 'suspend') then
    update public.github_installations set installation_status = case when action = 'deleted' then 'removed' else 'access_required' end where id = iid;
    update public.repositories set sync_status = case when action = 'deleted' then 'removed' else 'access_required' end where github_installation_id = iid;
  elsif event = 'installation' and action in ('new_permissions_accepted', 'unsuspend') then
    update public.github_installations set installation_status = 'access_required' where id = iid and installation_status <> 'removed';
    update public.repositories set sync_status = 'access_required' where github_installation_id = iid and sync_status <> 'removed';
  elsif event = 'installation_repositories' then
    update public.github_installations set needs_sync = true where id = iid;
    update public.repositories set sync_status = 'removed' where github_installation_id = iid and github_repository_id in (select (r->>'id')::bigint from jsonb_array_elements(coalesce(payload->'repositories_removed','[]'::jsonb)) r);
    -- Additions require an authenticated refresh from GitHub, never webhook
    -- payload assertions. Existing connections remain intact until refresh.
  end if;
  return true;
end;
$$;

create function private.disconnect_installation(iid uuid, wid uuid) returns void language sql security definer set search_path = '' as $$
  update public.github_installations set installation_status = 'access_required' where id = iid and workspace_id = wid;
  update public.repositories set sync_status = 'access_required' where github_installation_id = iid and workspace_id = wid;
$$;
create function public.issue_installation_state(token_hash text, user_id uuid, workspace_id uuid, return_to text) returns void language sql security invoker set search_path = '' as $$ select private.issue_installation_state(token_hash,user_id,workspace_id,return_to); $$;
create function public.consume_installation_state(hash text, uid uuid) returns table(workspace_id uuid, return_to text) language sql security invoker set search_path = '' as $$ select * from private.consume_installation_state(hash,uid); $$;
create function public.sync_installation_repositories(iid uuid, repos jsonb) returns void language sql security invoker set search_path = '' as $$ select private.sync_installation_repositories(iid,repos); $$;
create function public.apply_github_webhook(delivery uuid, event text, payload jsonb) returns boolean language sql security invoker set search_path = '' as $$ select private.apply_github_webhook(delivery,event,payload); $$;
create function public.disconnect_installation(iid uuid, wid uuid) returns void language sql security invoker set search_path = '' as $$ select private.disconnect_installation(iid,wid); $$;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to service_role;
revoke execute on function private.issue_installation_state(text,uuid,uuid,text), private.consume_installation_state(text,uuid), private.sync_installation_repositories(uuid,jsonb), private.apply_github_webhook(uuid,text,jsonb), private.disconnect_installation(uuid,uuid) from authenticated;
revoke execute on function public.issue_installation_state(text,uuid,uuid,text), public.consume_installation_state(text,uuid), public.sync_installation_repositories(uuid,jsonb), public.apply_github_webhook(uuid,text,jsonb), public.disconnect_installation(uuid,uuid) from public, anon, authenticated;
grant execute on function public.issue_installation_state(text,uuid,uuid,text), public.consume_installation_state(text,uuid), public.sync_installation_repositories(uuid,jsonb), public.apply_github_webhook(uuid,text,jsonb), public.disconnect_installation(uuid,uuid) to service_role;

-- Idempotent explicit import runs with the caller's own RLS permissions.
create function public.import_local_workspace(projects jsonb, journeys jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare wid uuid := public.bootstrap_workspace(); p jsonb; j jsonb; pid uuid; mapping jsonb := '{}'::jsonb;
begin
  if jsonb_array_length(projects) > 50 or jsonb_array_length(journeys) > 250 then raise exception 'Import is too large'; end if;
  for p in select * from jsonb_array_elements(projects) loop
    pid := md5(wid::text || ':project:' || (p->>'source_id'))::uuid;
    insert into public.projects(id,workspace_id,name,target_url,description) values(pid,wid,p->>'name',p->>'target_url',coalesce(p->>'description','')) on conflict do nothing;
    select id into pid from public.projects where workspace_id=wid and name=p->>'name' and target_url=p->>'target_url';
    if pid is null then raise exception 'Conflicting import record'; end if;
    mapping := mapping || jsonb_build_object(p->>'source_id',pid::text);
  end loop;
  for j in select * from jsonb_array_elements(journeys) loop
    pid := (mapping->>(j->>'project_source_id'))::uuid;
    if pid is null then raise exception 'Journey project is missing'; end if;
    insert into public.journeys(id,project_id,name,start_path,success_condition) values(md5(wid::text || ':journey:' || (j->>'source_id'))::uuid,pid,j->>'name',j->>'start_path',j->>'success_condition') on conflict do nothing;
  end loop;
end;
$$;
revoke execute on function public.import_local_workspace(jsonb,jsonb) from public, anon;
grant execute on function public.import_local_workspace(jsonb,jsonb) to authenticated;
commit;
