"use client";
import { useEffect, useState } from "react";
import Link from "./workspace-link";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import { PageHeader, StatusIndicator, EmptyState } from "./ui";
import { errorMessage } from "./feedback";
import { runSchema, type RunStatus, duration } from "@/lib/model";
type Execution = {
  id: string;
  projectId: string;
  status: RunStatus;
  deadline: string;
  error: string | null;
  warning: string | null;
  githubUrl: string | null;
  runs: ReturnType<typeof runSchema.array>["_output"];
};
export function ExecutionOverview({ id }: { id: string }) {
  const { updateRunViews } = useWorkspace();
  const [data, setData] = useState<Execution | null>(null),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let count = 0;
    async function poll() {
      try {
        const result = await apiRequest(`/api/executions/${id}`);
        result.runs = runSchema.array().parse(result.runs);
        if (!alive) return;
        setData(result);
        updateRunViews?.(result.runs);
        setError(null);
        count++;
        if (["queued", "running"].includes(result.status) && count < 360)
          timer = setTimeout(poll, 5000);
      } catch (e) {
        if (alive) setError(errorMessage(e));
      }
    }
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, attempt, updateRunViews]);
  if (!data)
    return (
      <EmptyState
        title={error ? "Execution unavailable" : "Loading execution"}
        description={error || "Reading the persisted execution state."}
        action={
          error && (
            <button
              className="button secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry
            </button>
          )
        }
      />
    );
  return (
    <>
      <PageHeader
        title="Test execution"
        eyebrow={
          <>
            <Link href={`/app/projects/${data.projectId}`}>Project</Link>
            <span>/</span>
            <span>Execution</span>
          </>
        }
        description="Reported browser outcomes from GitHub Actions."
        action={
          <>
            <button
              className="button secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Refresh
            </button>
            {["queued", "running"].includes(data.status) && (
              <button
                className="button secondary"
                disabled={cancelling}
                onClick={async () => {
                  setCancelling(true);
                  try {
                    const result = await apiRequest(
                      `/api/executions/${id}`,
                      {},
                    );
                    if (result.warning) setError(result.warning);
                    setAttempt((n) => n + 1);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                {cancelling ? "Cancelling…" : "Cancel execution"}
              </button>
            )}
          </>
        }
      />
      <div className="run-result-banner">
        <StatusIndicator status={data.status} large />
        {data.githubUrl && (
          <a
            className="text-link"
            href={data.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open GitHub Actions
          </a>
        )}
      </div>
      {(error || data.error || data.warning) && (
        <p className="form-error" role="alert">
          {error || data.error || data.warning}
        </p>
      )}
      <ul className="journey-list">
        {data.runs.map((run) => (
          <li key={run.id} className="journey-row">
            <div className="journey-identity">
              <Link className="text-link" href={`/app/runs/${run.id}`}>
                {run.journeyName}
              </Link>
              {run.error && <p>{run.error}</p>}
            </div>
            <StatusIndicator status={run.status} />
            <span className="mono">{duration(run.duration)}</span>
          </li>
        ))}
      </ul>
      <p className="field-hint">
        Queued means dispatched, not passed. Results appear only when the
        verified runner reports them. Active runs refresh every five seconds,
        for at most thirty minutes; use Refresh to resume checking.
      </p>
    </>
  );
}
