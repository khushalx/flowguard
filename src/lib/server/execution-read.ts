import "server-only";
import { requireWorkspace } from "./auth";
import { AppError, dbCheck } from "./http";
import { actionsClient, engineOperation } from "./execution";
import { readRun } from "./workspace";
import { adminClient } from "../supabase/admin";

type Context = Awaited<ReturnType<typeof requireWorkspace>>;
async function ownedBatch(context: Context, id: string) {
  const found = await context.db
    .from("execution_batches")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  dbCheck(found.error);
  if (!found.data)
    throw new AppError("Execution not found in this workspace.", 404);
  return found.data;
}
export async function readExecution(context: Context, id: string) {
  await ownedBatch(context, id);
  await engineOperation("expire");
  let batch = await ownedBatch(context, id);
  let warning: string | null = null;
  if (["queued", "running"].includes(batch.status)) {
    const lock = await engineOperation("reconcile_lock", { batch_id: id });
    if (lock.allowed)
      try {
        const github = await actionsClient(
          Number(batch.installation_id),
          Number(batch.github_repository_id),
        );
        const [owner, repo] = batch.repository_name.split("/");
        let runId = batch.github_run_id;
        if (!runId) {
          const response = await github.request(
            "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
            {
              owner,
              repo,
              workflow_id: batch.workflow_id,
              per_page: 20,
              event: "workflow_dispatch",
            },
          );
          const match = response.data.workflow_runs.find(
            (run) =>
              run.display_title === `FlowGuard ${id}` &&
              run.head_branch === batch.branch &&
              Date.parse(run.created_at) >=
                Date.parse(batch.created_at) - 10_000,
          );
          if (match) {
            runId = match.id;
            await engineOperation("dispatch", {
              batch_id: id,
              github_run_id: runId,
            });
          }
        }
        if (runId) {
          const { data: remote } = await github.request(
            "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
            { owner, repo, run_id: Number(runId) },
          );
          if (
            remote.repository.id !== Number(batch.github_repository_id) ||
            remote.workflow_id !== Number(batch.workflow_id) ||
            remote.event !== "workflow_dispatch" ||
            remote.display_title !== `FlowGuard ${id}`
          )
            throw new AppError("Workflow identity could not be verified.", 409);
          if (
            remote.status === "completed" &&
            Date.now() - Date.parse(remote.updated_at) > 30_000
          )
            await engineOperation("terminate", {
              batch_id: id,
              status:
                remote.conclusion === "cancelled"
                  ? "cancelled"
                  : remote.conclusion === "timed_out"
                    ? "timed_out"
                    : "error",
              error: `GitHub Actions ended (${remote.conclusion || "unknown"}) before all verified results arrived. Inspect the job logs and retry.`,
            });
        }
      } catch (error) {
        warning =
          error instanceof AppError
            ? error.message
            : "GitHub reconciliation is unavailable. The execution deadline still applies.";
        console.info("FlowGuard execution reconciliation unavailable", {
          status: (error as { status?: number })?.status ?? 0,
        });
      }
    batch = await ownedBatch(context, id);
  }
  const records = await context.db
    .from("runs")
    .select("id")
    .eq("batch_id", id)
    .order("number");
  dbCheck(records.error);
  const runs = await Promise.all(
    (records.data ?? []).map((r) => readRun(context, r.id)),
  );
  return {
    id: batch.id,
    projectId: batch.project_id,
    status: batch.status,
    createdAt: batch.created_at,
    startedAt: batch.started_at,
    completedAt: batch.completed_at,
    deadline: batch.deadline,
    error: batch.error_message,
    warning,
    githubUrl: batch.github_run_id
      ? `https://github.com/${batch.repository_name}/actions/runs/${batch.github_run_id}`
      : null,
    runs,
  };
}
export async function cancelExecution(context: Context, id: string) {
  const batch = await ownedBatch(context, id);
  await engineOperation("terminate", {
    batch_id: id,
    status: "cancelled",
    error: "Execution cancelled by a workspace administrator.",
  });
  if (batch.github_run_id && ["queued", "running"].includes(batch.status))
    try {
      const github = await actionsClient(
        Number(batch.installation_id),
        Number(batch.github_repository_id),
      );
      const [owner, repo] = batch.repository_name.split("/");
      await github.request(
        "POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel",
        { owner, repo, run_id: Number(batch.github_run_id) },
      );
    } catch (error) {
      if ((error as { status?: number })?.status !== 409)
        return {
          cancelled: true,
          warning:
            "Results are locked as cancelled; GitHub cancellation could not be confirmed. Stop the job in GitHub Actions if it is still running.",
        };
    }
  return { cancelled: true };
}
export async function artifactDownload(context: Context, id: string) {
  const artifact = await context.db
    .from("run_artifacts")
    .select("object_path,expires_at")
    .eq("run_id", id)
    .eq("uploaded", true)
    .maybeSingle();
  dbCheck(artifact.error);
  if (!artifact.data || Date.parse(artifact.data.expires_at) < Date.now())
    throw new AppError(
      "Screenshot is unavailable or its retention period expired.",
      404,
    );
  const result = await adminClient()
    .storage.from("flowguard-evidence")
    .createSignedUrl(artifact.data.object_path, 60);
  dbCheck(result.error);
  return result.data!.signedUrl;
}
export async function reconcileAndRetain() {
  await engineOperation("expire");
  const expired = await engineOperation("cleanup_list");
  if (expired.paths?.length) {
    const removed = await adminClient()
      .storage.from("flowguard-evidence")
      .remove(expired.paths);
    dbCheck(removed.error);
  }
  await engineOperation("cleanup_delete");
  return { ok: true, removed: expired.paths?.length ?? 0 };
}
