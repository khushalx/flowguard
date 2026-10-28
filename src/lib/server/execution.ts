import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { adminClient } from "../supabase/admin";
import { requireWorkspace } from "./auth";
import { AppError, dbCheck } from "./http";
import {
  createGitHubApp,
  GitHubClient,
  githubConfigurationIssue,
} from "./github-client";
import {
  approvedUrl,
  publicAddress,
  resolveDestination,
} from "../../../packages/runner/src/network";
import {
  journeyDefinitionSchema,
  executionResultSchema,
} from "../../../packages/runner/src/schema";

type Context = Awaited<ReturnType<typeof requireWorkspace>>;
export const verifier = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newCredential = (kind: "run" | "exec") =>
  `fg_${kind}_${randomBytes(32).toString("base64url")}`;
export async function engineOperation(
  op: string,
  args: Record<string, unknown> = {},
) {
  const result = await adminClient().rpc("engine_operation", { op, args });
  if (result.error) {
    console.error("FlowGuard execution operation failed", {
      operation: op,
      code: result.error.code,
    });
    if (result.error.code === "42501")
      throw new AppError("Runner or workspace authorization failed.", 403);
    if (result.error.code === "P0002")
      throw new AppError("Execution resource not found.", 404);
    if (result.error.code === "23505")
      throw new AppError(
        "An execution is already active. Open its results before retrying.",
        409,
      );
    const safe = [
      "A project execution is already active",
      "Workspace limit:",
      "Configure a runner credential first",
      "Select between",
      "Selected journeys",
      "Execution cannot be claimed",
      "Terminal results cannot",
      "Run has not started",
      "Artifact capture is not enabled",
      "Execution is no longer running",
    ];
    if (
      result.error.code === "P0001" &&
      safe.some((s) => result.error!.message.startsWith(s))
    )
      throw new AppError(result.error.message, 409);
    throw new AppError(
      "Execution could not be saved. Confirm the engine migration is installed and retry.",
      503,
    );
  }
  return result.data;
}
export async function projectExecution(context: Context, id: string) {
  const project = await context.db
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  dbCheck(project.error);
  if (!project.data)
    throw new AppError("Project not found in this workspace.", 404);
  if (!project.data.repository_id)
    throw new AppError(
      "Connect a repository in project settings before running tests.",
      409,
    );
  const repo = await context.db
    .from("repositories")
    .select("*")
    .eq("id", project.data.repository_id)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(repo.error);
  const installation = await context.db
    .from("github_installations")
    .select("*")
    .eq("id", repo.data!.github_installation_id)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(installation.error);
  if (
    repo.data!.sync_status !== "connected" ||
    installation.data!.installation_status !== "connected"
  )
    throw new AppError(
      "Refresh repository access in Connections before running tests.",
      409,
    );
  return {
    project: project.data,
    repository: repo.data!,
    installation: installation.data!,
  };
}
export async function actionsClient(
  installationId: number,
  repositoryId: number,
) {
  const issue = githubConfigurationIssue();
  if (issue) throw new AppError(issue, 503);
  const app = createGitHubApp();
  const installation = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (installation.data.permissions.actions !== "write")
    throw new AppError(
      "GitHub App setup required: enable repository Actions: write, then approve the updated installation. No Contents write permission is needed.",
      409,
    );
  const grant = await app.octokit.request(
    "POST /app/installations/{installation_id}/access_tokens",
    {
      installation_id: installationId,
      repository_ids: [repositoryId],
      permissions: { metadata: "read", actions: "write" },
    },
  );
  return new GitHubClient({ auth: grant.data.token });
}
const actorArgs = (context: Context, projectId: string) => ({
  project_id: projectId,
  workspace_id: context.workspaceId,
  actor_id: context.user.id,
});
export async function runnerCredential(
  context: Context,
  id: string,
  action: "status" | "rotate" | "revoke",
) {
  if (action !== "status" && context.role !== "owner")
    throw new AppError(
      "Only the workspace owner can manage runner credentials.",
      403,
    );
  if (action === "status")
    return engineOperation("credential_status", actorArgs(context, id));
  const credential = action === "rotate" ? newCredential("run") : undefined;
  await engineOperation(action === "rotate" ? "credential" : "revoke", {
    ...actorArgs(context, id),
    ...(credential ? { verifier: verifier(credential) } : {}),
  });
  return credential ? { credential, expiresInDays: 90 } : { revoked: true };
}
export async function executionSetup(context: Context, projectId: string) {
  const credential = await runnerCredential(context, projectId, "status");
  const rows = await context.db
    .from("journeys")
    .select("id,name,enabled,configuration,start_path")
    .eq("project_id", projectId);
  dbCheck(rows.error);
  const valid = (rows.data ?? []).filter(
    (j) =>
      j.enabled && journeyDefinitionSchema.safeParse(j.configuration).success,
  );
  const skipped = (rows.data ?? [])
    .filter((j) => !valid.some((v) => v.id === j.id))
    .map((j) => ({
      name: j.name,
      reason: !j.enabled
        ? "Disabled"
        : "Needs structured steps and a positive assertion",
    }));
  try {
    const linked = await projectExecution(context, projectId);
    const github = await actionsClient(
      Number(linked.installation.github_installation_id),
      Number(linked.repository.github_repository_id),
    );
    const workflow = await github.request(
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}",
      {
        owner: linked.repository.owner_login,
        repo: linked.repository.name,
        workflow_id: "flowguard.yml",
      },
    );
    if (workflow.data.state !== "active")
      throw new AppError(
        "Enable flowguard.yml on your repository's default branch.",
        409,
      );
    return {
      ready: !!credential.configured,
      credentialConfigured: !!credential.configured,
      validJourneys: valid.map((j) => ({ id: j.id, name: j.name })),
      skipped,
      message: credential.configured
        ? null
        : "Create a runner credential and save it as the FLOWGUARD_RUNNER_TOKEN repository Actions secret.",
    };
  } catch (error) {
    return {
      ready: false,
      credentialConfigured: !!credential.configured,
      validJourneys: valid.map((j) => ({ id: j.id, name: j.name })),
      skipped,
      message: executionMessage(error),
    };
  }
}
function executionMessage(error: unknown) {
  if (error instanceof AppError) return error.message;
  const status = (error as { status?: number })?.status;
  return status === 404
    ? "Add the FlowGuard workflow as .github/workflows/flowguard.yml on the repository's default branch, then retry."
    : status === 403
      ? "GitHub denied Actions access. Check App permissions, installation approval and Actions availability."
      : "GitHub Actions could not be reached. Retry shortly; no successful execution is assumed.";
}
export async function queueExecution(
  context: Context,
  input: { projectId: string; requestId: string; journeyIds?: string[] },
) {
  await engineOperation("expire");
  const linked = await projectExecution(context, input.projectId);
  const target = approvedUrl(
    linked.project.target_url,
    linked.project.target_url,
  );
  const addresses = await resolveDestination(
    new URL(target).hostname.replace(/^\[|\]$/g, ""),
  );
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new AppError(
      "Hosted execution requires a public project target; private networks and metadata addresses are blocked.",
      400,
    );
  const journeys = await context.db
    .from("journeys")
    .select("id,enabled,configuration,start_path")
    .eq("project_id", input.projectId);
  dbCheck(journeys.error);
  const valid = (journeys.data ?? []).filter(
    (j) =>
      j.enabled && journeyDefinitionSchema.safeParse(j.configuration).success,
  );
  const selected = input.journeyIds
    ? valid.filter((j) => input.journeyIds!.includes(j.id))
    : valid;
  if (input.journeyIds && selected.length !== new Set(input.journeyIds).size)
    throw new AppError(
      "A selected journey is disabled, missing or needs configuration.",
      400,
    );
  if (!selected.length || selected.length > 5)
    throw new AppError("Run between 1 and 5 valid journeys per batch.", 400);
  for (const journey of selected) {
    approvedUrl(journey.start_path, target);
    for (const step of journeyDefinitionSchema.parse(journey.configuration)
      .steps)
      if (step.action === "navigate") approvedUrl(step.path, target);
  }
  let batchId: string | undefined;
  try {
    const github = await actionsClient(
      Number(linked.installation.github_installation_id),
      Number(linked.repository.github_repository_id),
    );
    const repo = {
      owner: linked.repository.owner_login,
      repo: linked.repository.name,
    };
    const remote = await github.request("GET /repos/{owner}/{repo}", repo);
    if (
      remote.data.id !== Number(linked.repository.github_repository_id) ||
      remote.data.default_branch !== linked.repository.default_branch
    )
      throw new AppError(
        "Repository identity or default branch changed. Refresh repository access first.",
        409,
      );
    const workflow = await github.request(
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}",
      { ...repo, workflow_id: "flowguard.yml" },
    );
    if (workflow.data.state !== "active")
      throw new AppError(
        "Enable the FlowGuard workflow on the default branch.",
        409,
      );
    const queued = await engineOperation("queue", {
      ...actorArgs(context, input.projectId),
      request_id: input.requestId,
      journey_ids: selected.map((j) => j.id),
      workflow_id: workflow.data.id,
    });
    batchId = queued.id;
    if (queued.duplicate) return { id: batchId };
    const dispatched = await github.request(
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
      {
        ...repo,
        workflow_id: workflow.data.id,
        ref: linked.repository.default_branch,
        inputs: { batch_id: batchId! },
        headers: { "X-GitHub-Api-Version": "2026-03-10" },
      },
    );
    const details = dispatched.data as unknown as { workflow_run_id?: number };
    if (details?.workflow_run_id)
      await engineOperation("dispatch", {
        batch_id: batchId,
        github_run_id: details.workflow_run_id,
      });
    return { id: batchId };
  } catch (error) {
    const message = executionMessage(error);
    if (batchId)
      await engineOperation("terminate", {
        batch_id: batchId,
        status: "error",
        error: message,
      });
    if (error instanceof AppError) throw error;
    console.error("FlowGuard dispatch failed", {
      status: (error as { status?: number })?.status ?? 0,
    });
    throw new AppError(message, 503);
  }
}
export async function runnerAuthorization(
  request: Request,
  kind: "run" | "exec",
) {
  const gate = await engineOperation("gate");
  if (!gate.allowed)
    throw new AppError("Runner request limit reached. Retry next minute.", 429);
  const value = request.headers.get("authorization");
  if (
    !value ||
    !new RegExp(`^Bearer fg_${kind}_[A-Za-z0-9_-]{43}$`).test(value)
  )
    throw new AppError("Runner authentication required.", 401);
  return verifier(value.slice(7));
}
export const claimInput = z
  .object({
    batchId: z.string().uuid(),
    githubRunId: z.number().int().positive().safe(),
    repositoryId: z.number().int().positive().safe(),
  })
  .strict();
export async function claimExecution(hash: string, raw: unknown) {
  const input = claimInput.parse(raw);
  const context = await engineOperation("claim_context", {
    batch_id: input.batchId,
    credential_verifier: hash,
  });
  if (Number(context.repositoryId) !== input.repositoryId)
    throw new AppError(
      "Repository identity does not match this execution.",
      403,
    );
  const github = await actionsClient(
    Number(context.installationId),
    Number(context.repositoryId),
  );
  const [owner, repo] = String(context.repository).split("/");
  const { data: run } = await github.request(
    "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
    { owner, repo, run_id: input.githubRunId },
  );
  if (
    run.repository.id !== input.repositoryId ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== context.branch ||
    run.workflow_id !== Number(context.workflowId) ||
    run.display_title !== `FlowGuard ${input.batchId}` ||
    (context.githubRunId && Number(context.githubRunId) !== run.id) ||
    !["queued", "in_progress"].includes(run.status || "")
  )
    throw new AppError(
      "GitHub workflow metadata does not authorize this execution.",
      403,
    );
  const token = newCredential("exec");
  const configuration = await engineOperation("claim", {
    batch_id: input.batchId,
    credential_verifier: hash,
    token_verifier: verifier(token),
    github_run_id: run.id,
    commit_sha: run.head_sha,
  });
  return { ...configuration, token, expiresInSeconds: 900 };
}
export const completeInput = z
  .object({
    batchId: z.string().uuid(),
    runId: z.string().uuid(),
    result: executionResultSchema,
  })
  .strict();
export async function completeExecution(hash: string, raw: unknown) {
  const input = completeInput.parse(raw);
  return engineOperation("complete", {
    batch_id: input.batchId,
    run_id: input.runId,
    token_verifier: hash,
    result: input.result,
    digest: verifier(JSON.stringify(input.result)),
  });
}
