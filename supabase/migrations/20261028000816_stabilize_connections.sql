-- Read-only, RLS-bound context replaces write-heavy bootstrap on routine requests.
create function public.workspace_context()
returns table(id uuid, name text, role text, username text, full_name text, avatar_url text)
language sql stable security invoker set search_path = '' as $$
  select w.id, w.name, m.role, p.username, p.full_name, p.avatar_url
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  join public.profiles p on p.id = m.user_id
  where w.owner_id = (select auth.uid()) and m.user_id = (select auth.uid());
$$;
revoke all on function public.workspace_context() from public, anon;
grant execute on function public.workspace_context() to authenticated;

-- Keep project/journey health correct even when older history is paginated.
create index runs_latest_journey on public.runs(project_id, journey_id, started_at desc, id desc);
create function public.latest_workspace_runs(wid uuid) returns setof public.runs
language sql stable security invoker set search_path = '' as $$
  select distinct on (r.project_id, r.journey_id) r.*
  from public.runs r join public.projects p on p.id = r.project_id
  where p.workspace_id = wid
  order by r.project_id, r.journey_id, r.started_at desc, r.id desc;
$$;
revoke all on function public.latest_workspace_runs(uuid) from public, anon;
grant execute on function public.latest_workspace_runs(uuid) to authenticated;

-- Hosted advisors flagged Supabase's optional auto-RLS event-trigger helper.
-- It belongs to the DDL event-trigger manager, not the public RPC surface.
do $$
begin
  if exists (select 1 from pg_catalog.pg_proc where oid = pg_catalog.to_regprocedure('public.rls_auto_enable()') and prorettype = 'event_trigger'::regtype) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Workspace-scoped freshness, invalidated by existing status/needs_sync webhooks.
alter table public.github_installations add column last_synced_at timestamptz;
alter table public.github_installations add column disconnected_at timestamptz;
create or replace function private.sync_installation_repositories(iid uuid, repos jsonb) returns void language plpgsql security definer set search_path = '' as $$
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
  update public.github_installations set needs_sync = false, last_synced_at = now() where id = iid;
end;
$$;


-- An explicit disconnect must survive automatic discovery on the next visit.
create or replace function private.disconnect_installation(iid uuid, wid uuid)
returns void language sql security definer set search_path = '' as $$
  update public.github_installations set installation_status = 'access_required',
    disconnected_at = now(), last_synced_at = null where id = iid and workspace_id = wid;
  update public.repositories set sync_status = 'access_required'
    where github_installation_id = iid and workspace_id = wid;
$$;
