import "server-only";
import { requireWorkspace } from "./auth";
import { readRun, runRecord } from "./workspace";
import { attachSnapshot, sanitizeRun, digest } from "./report-snapshot";
import {
  compareHistory,
  explain,
  fixPrompt,
  unsuccessful,
} from "../investigation/evidence";
import { analysisEvidence, aiConfiguration } from "../investigation/ai";
import { appOrigin } from "../env";
import { AppError, dbCheck } from "./http";
type Context = Awaited<ReturnType<typeof requireWorkspace>>;
export async function runReport(context: Context, id: string) {
  const started = performance.now();
  const run = await readRun(context, id);
  // Bounded, independent reads run in parallel after authorization.
  const [projectResult, rows] = await Promise.all([
    context.db
      .from("projects")
      .select("*")
      .eq("id", run.projectId)
      .eq("workspace_id", context.workspaceId)
      .single(),
    run.journeyId
      ? context.db
          .from("runs")
          .select(
            "id,number,project_id,journey_id,journey_name,status,started_at,duration_ms,branch,commit_sha,commit_message,environment,browser,batch_id,failure_category,error_message,configuration,verification_of,assertion,run_steps(name,status,error_message,metadata,sequence_number),execution_batches(repository_name)",
          )
          .eq("project_id", run.projectId)
          .eq("journey_id", run.journeyId)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(101)
      : { data: [], error: null },
  ]);
  dbCheck(projectResult.error);
  if (!projectResult.data) throw new AppError("Project unavailable.", 404);
  const p = projectResult.data;
  const project = {
    id: p.id,
    name: p.name,
    url: p.target_url,
    repository: run.snapshot?.repository || "",
    description: p.description,
    createdAt: p.created_at,
  };
  dbCheck(rows.error);
  const history = (rows.data || [])
    .slice(0, 100)
    .map((r) =>
      sanitizeRun(
        attachSnapshot(
          runRecord(r),
          r.configuration,
          (Array.isArray(r.execution_batches)
            ? r.execution_batches[0]?.repository_name
            : (r.execution_batches as { repository_name?: string } | null)
                ?.repository_name) || "",
        ),
        r.configuration,
      ),
    );
  const evidenceMs = performance.now() - started;
  const promptStarted = performance.now();
  const prompt = fixPrompt(run, project, `${appOrigin()}/app`);
  const templateMs = performance.now() - promptStarted;
  const comparisonStarted = performance.now();
  const comparison = compareHistory(
    run,
    history,
    (rows.data?.length || 0) > 100,
  );
  const comparisonMs = performance.now() - comparisonStarted;
  const ai = aiConfiguration();
  return {
    run,
    summary: explain(run),
    prompt,
    comparison,
    timing: { evidenceMs, templateMs, comparisonMs },
    ai: {
      enabled: ai.enabled,
      model: ai.model,
      evidenceHash: digest(analysisEvidence(run)),
      evidence: unsuccessful(run) ? analysisEvidence(run) : [],
    },
    canVerify: unsuccessful(run) && !!run.snapshot && !!run.journeyId,
  };
}
export type RunReport = Awaited<ReturnType<typeof runReport>>;
