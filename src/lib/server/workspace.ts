import "server-only";
import {
  workspaceSchema,
  runSchema,
  type Project,
  type Journey,
} from "../model";
import {
  mutationSchema,
  type Repository,
  type Installation,
  type WorkspaceInfo,
} from "../contracts";
import { requireWorkspace } from "./auth";
import { AppError, dbCheck } from "./http";
import { verifyRepositoryAccess } from "./github";
import { journeyDefinitionSchema } from "../../../packages/runner/src/schema";

type Context = Awaited<ReturnType<typeof requireWorkspace>>;
export async function readWorkspace(context: Context) {
  const { db, user, workspaceId, role, member } = context;
  const results = await Promise.all([
    db
      .from("projects")
      .select("id,name,target_url,description,repository_id,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at"),
    db
      .from("journeys")
      .select(
        "id,project_id,name,start_path,success_condition,configuration,enabled,created_at,projects!inner(workspace_id)",
      )
      .eq("projects.workspace_id", workspaceId)
      .order("created_at"),
    readInitialRuns(context),
    db
      .from("repositories")
      .select("id,full_name,is_private,default_branch,sync_status")
      .eq("workspace_id", workspaceId),
    db
      .from("github_installations")
      .select(
        "id,github_installation_id,github_account_login,installation_status,needs_sync",
      )
      .eq("workspace_id", workspaceId),
  ]);
  results.forEach((r) => {
    if ("error" in r) dbCheck(r.error);
  });
  const [projects, journeys, runs, repos, installations] = results;
  const repositories: Repository[] = (repos.data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    private: r.is_private,
    defaultBranch: r.default_branch,
    status: r.sync_status,
  }));
  const workspace = workspaceSchema.parse({
    projects: (projects.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      url: p.target_url,
      description: p.description,
      repositoryId: p.repository_id,
      repository:
        repositories.find((r) => r.id === p.repository_id)?.fullName ?? "",
      createdAt: p.created_at,
    })),
    journeys: (journeys.data ?? []).map((j) => ({
      id: j.id,
      projectId: j.project_id,
      name: j.name,
      path: j.start_path,
      condition: j.success_condition,
      definition: journeyDefinitionSchema.safeParse(j.configuration).data,
      enabled: j.enabled,
      createdAt: j.created_at,
    })),
    runs: runs.runs,
  });
  const avatar = member.avatar_url;
  const info: WorkspaceInfo = {
    id: workspaceId,
    name: member.name,
    role,
    account: {
      id: user.id,
      name: member.full_name || member.username || "Your account",
      username: member.username ?? null,
      email: user.email ?? null,
      avatar:
        typeof avatar === "string" &&
        /^https:\/\/avatars\.githubusercontent\.com\//.test(avatar)
          ? avatar
          : null,
    },
  };
  return {
    workspace,
    runsHasMore: runs.hasMore,
    runOffset: runs.offset,
    info,
    repositories,
    installations: (installations.data ?? []).map((i) => ({
      id: i.id,
      account: i.github_account_login,
      status: i.installation_status,
      needsSync: i.needs_sync,
      managementUrl: `https://github.com/settings/installations/${i.github_installation_id}`,
    })) as Installation[],
  };
}
export type LiveSnapshot = Awaited<ReturnType<typeof readWorkspace>>;

export async function mutateWorkspace(raw: unknown, context: Context) {
  const mutation = mutationSchema.parse(raw);
  const { db, workspaceId } = context;
  async function ownedProject(id: string) {
    const result = await db
      .from("projects")
      .select("id,repository_id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    dbCheck(result.error);
    if (!result.data)
      throw new AppError("Project not found in this workspace.", 404);
    return result.data;
  }
  if (
    mutation.action === "createProject" ||
    mutation.action === "updateProject"
  ) {
    const { input } = mutation;
    const current =
      mutation.action === "updateProject"
        ? await ownedProject(mutation.id)
        : null;
    if (input.repositoryId && input.repositoryId !== current?.repository_id)
      await verifyRepositoryAccess(context, input.repositoryId);
    const repository = input.repositoryId
      ? await repositoryName(context, input.repositoryId)
      : "";
    const values = {
      workspace_id: workspaceId,
      name: input.name,
      target_url: input.url,
      description: input.description,
      repository_id: input.repositoryId,
    };
    if (mutation.action === "updateProject") {
      // Workspace ID is immutable; the server never accepts it from the client.
      const { workspace_id: _workspace, ...patch } = values;
      void _workspace;
      const result = await db
        .from("projects")
        .update(patch)
        .eq("id", mutation.id)
        .eq("workspace_id", workspaceId)
        .select("*")
        .single();
      dbCheck(result.error);
      return {
        id: result.data!.id as string,
        project: projectRecord(result.data!, repository),
      };
    }
    const result = await db
      .from("projects")
      .insert(values)
      .select("*")
      .single();
    dbCheck(result.error);
    return {
      id: result.data!.id as string,
      project: projectRecord(result.data!, repository),
    };
  }
  if (mutation.action === "deleteProject") {
    await ownedProject(mutation.id);
    const result = await db
      .from("projects")
      .delete()
      .eq("id", mutation.id)
      .eq("workspace_id", workspaceId);
    dbCheck(result.error);
    return { id: mutation.id };
  }
  if (mutation.action === "saveJourney") {
    await ownedProject(mutation.input.projectId);
    const values = {
      project_id: mutation.input.projectId,
      name: mutation.input.name,
      start_path: mutation.input.path,
      success_condition: mutation.input.condition,
      configuration: mutation.input.definition ?? {},
      enabled: mutation.input.enabled ?? true,
    };
    const result = mutation.id
      ? await db
          .from("journeys")
          .update({
            name: values.name,
            start_path: values.start_path,
            success_condition: values.success_condition,
            configuration: values.configuration,
            enabled: values.enabled,
          })
          .eq("id", mutation.id)
          .eq("project_id", values.project_id)
          .select("*")
          .single()
      : await db.from("journeys").insert(values).select("*").single();
    dbCheck(result.error);
    return {
      id: result.data!.id as string,
      journey: journeyRecord(result.data!),
    };
  }
  if (mutation.action === "deleteJourney") {
    const found = await db
      .from("journeys")
      .select("project_id")
      .eq("id", mutation.id)
      .maybeSingle();
    dbCheck(found.error);
    if (!found.data) throw new AppError("Journey not found.", 404);
    await ownedProject(found.data.project_id);
    const result = await db.from("journeys").delete().eq("id", mutation.id);
    dbCheck(result.error);
    return { id: mutation.id };
  }
  // Explicit import only: deterministic UUIDs derived from original IDs are
  // scoped to this workspace by the transactional RPC. No demo runs imported.
  const projects: Project[] = mutation.projects;
  const journeys: Journey[] = mutation.journeys;
  projects.forEach((p) => {
    mutationSchema.options[0].shape.input.parse({ ...p, repositoryId: null });
  });
  const result = await db.rpc("import_local_workspace", {
    projects: projects.map((p) => ({
      source_id: p.id,
      name: p.name,
      target_url: p.url,
      description: p.description,
    })),
    journeys: journeys.map((j) => ({
      source_id: j.id,
      project_source_id: j.projectId,
      name: j.name,
      start_path: j.path,
      success_condition: j.condition,
    })),
  });
  dbCheck(result.error);
  return { id: workspaceId };
}

export async function readConnections(context: Context) {
  const [repos, installs] = await Promise.all([
    context.db
      .from("repositories")
      .select("id,full_name,is_private,default_branch,sync_status")
      .eq("workspace_id", context.workspaceId)
      .order("full_name"),
    context.db
      .from("github_installations")
      .select(
        "id,github_installation_id,github_account_login,installation_status,needs_sync",
      )
      .eq("workspace_id", context.workspaceId),
  ]);
  dbCheck(repos.error);
  dbCheck(installs.error);
  return {
    repositories: (repos.data ?? []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      private: r.is_private,
      defaultBranch: r.default_branch,
      status: r.sync_status,
    })) as Repository[],
    installations: (installs.data ?? []).map((i) => ({
      id: i.id,
      account: i.github_account_login,
      status: i.installation_status,
      needsSync: i.needs_sync,
      managementUrl: `https://github.com/settings/installations/${i.github_installation_id}`,
    })) as Installation[],
  };
}
async function repositoryName(context: Context, id: string) {
  const r = await context.db
    .from("repositories")
    .select("full_name")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(r.error);
  return r.data!.full_name as string;
}
function projectRecord(p: Record<string, unknown>, repository: string) {
  return {
    id: p.id,
    name: p.name,
    url: p.target_url,
    description: p.description,
    repositoryId: p.repository_id,
    createdAt: p.created_at,
    repository,
  } as Project;
}
function journeyRecord(j: Record<string, unknown>) {
  return {
    id: j.id,
    projectId: j.project_id,
    name: j.name,
    path: j.start_path,
    condition: j.success_condition,
    definition: journeyDefinitionSchema.safeParse(j.configuration).data,
    enabled: j.enabled,
    createdAt: j.created_at,
  } as Journey;
}

const runColumns =
  "id,number,project_id,journey_id,journey_name,status,started_at,duration_ms,branch,commit_sha,commit_message,environment,browser,batch_id,failure_category,error_message";
async function readInitialRuns(context: Context) {
  const [page, latest] = await Promise.all([
    readRunPage(context),
    context.db
      .rpc("latest_workspace_runs", { wid: context.workspaceId })
      .select(runColumns),
  ]);
  dbCheck(latest.error);
  if (latest.data && !Array.isArray(latest.data))
    throw new AppError("Run summaries could not be loaded. Try again.", 503);
  const known = new Set(page.runs.map((r) => r.id));
  return {
    ...page,
    offset: page.runs.length,
    runs: [
      ...page.runs,
      ...(Array.isArray(latest.data) ? latest.data : [])
        .map(runRecord)
        .filter((r) => !known.has(r.id)),
    ],
  };
}
export async function readRunPage(context: Context, offset = 0) {
  const result = await context.db
    .from("runs")
    .select(`${runColumns},projects!inner(workspace_id)`)
    .eq("projects.workspace_id", context.workspaceId)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 50);
  dbCheck(result.error);
  return {
    runs: (result.data ?? []).slice(0, 50).map(runRecord),
    hasMore: (result.data?.length ?? 0) > 50,
  };
}
export async function readRun(context: Context, id: string) {
  const result = await context.db
    .from("runs")
    .select(
      `${runColumns},logs,assertion,run_steps(name,status,error_message,metadata,sequence_number),projects!inner(workspace_id)`,
    )
    .eq("id", id)
    .eq("projects.workspace_id", context.workspaceId)
    .maybeSingle();
  dbCheck(result.error);
  if (!result.data) throw new AppError("Run not found in this workspace.", 404);
  const run = runRecord(result.data);
  if (result.data.batch_id) {
    const [artifact, batch] = await Promise.all([
      context.db
        .from("run_artifacts")
        .select("id,expires_at")
        .eq("run_id", id)
        .eq("uploaded", true)
        .maybeSingle(),
      context.db
        .from("execution_batches")
        .select("repository_name,github_run_id")
        .eq("id", result.data.batch_id)
        .maybeSingle(),
    ]);
    dbCheck(artifact.error);
    dbCheck(batch.error);
    if (artifact.data && Date.parse(artifact.data.expires_at) > Date.now())
      run.screenshot = `/api/runs/${id}/screenshot`;
    if (batch.data?.github_run_id)
      run.githubUrl = `https://github.com/${batch.data.repository_name}/actions/runs/${batch.data.github_run_id}`;
  }
  return run;
}
function runRecord(r: Record<string, unknown>) {
  return runSchema.parse({
    id: r.id,
    number: r.number,
    projectId: r.project_id,
    journeyId: r.journey_id ?? "",
    journeyName: r.journey_name,
    status: r.status,
    startedAt: r.started_at,
    duration: r.duration_ms,
    branch: r.branch ?? "",
    commit: r.commit_sha ?? "",
    commitMessage: r.commit_message ?? "",
    environment: r.environment ?? "",
    browser: r.browser ?? "",
    steps: (
      (r.run_steps ?? []) as {
        sequence_number: number;
        name: string;
        status: string;
        error_message: string | null;
        metadata: Record<string, unknown>;
      }[]
    )
      .sort(
        (a: { sequence_number: number }, b: { sequence_number: number }) =>
          a.sequence_number - b.sequence_number,
      )
      .map(
        (s: {
          name: string;
          status: string;
          error_message: string | null;
          metadata: Record<string, unknown>;
        }) => ({
          name: s.name,
          status: s.status,
          detail: s.error_message ?? "",
          duration:
            typeof s.metadata.duration_ms === "number"
              ? s.metadata.duration_ms
              : null,
        }),
      ),
    logs: r.logs ?? [],
    assertion: r.assertion ?? undefined,
    batchId: r.batch_id ?? undefined,
    failureCategory: r.failure_category ?? undefined,
    error: r.error_message ?? undefined,
  });
}
