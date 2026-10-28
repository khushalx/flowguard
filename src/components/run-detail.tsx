"use client";
import Link from "./workspace-link";
import { useState, useEffect, useRef } from "react";
import { ChevronDown, Copy, GitCommitHorizontal, Play } from "lucide-react";
import { duration, host } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import { useFeedback } from "./feedback";
import {
  MissingRecord,
  PageHeader,
  StatusIndicator,
  WorkspaceLoading,
  EmptyState,
} from "./ui";
import { Investigation } from "./investigation";
import { ExecutionLauncher } from "./execution-dialog";
import { unsuccessful } from "@/lib/investigation/evidence";
import { FailureTools } from "./failure-tools";

export function RunDetail({ id }: { id: string }) {
  const { workspace: w, data, isLive, loadRun } = useWorkspace();
  const [ready, setReady] = useState(!isLive);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const currentStatus = w?.runs.find((r) => r.id === id)?.status;
  const polls = useRef(0);
  useEffect(() => {
    if (!isLive) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function poll() {
      void loadRun(id)
        .then(() => {
          if (active) {
            setReady(true);
            polls.current++;
            if (
              ["queued", "running"].includes(currentStatus || "") &&
              polls.current < 180
            )
              timer = setTimeout(poll, 5000);
          }
        })
        .catch((e) => {
          if (active)
            setError(
              e instanceof Error
                ? e.message
                : "Run details could not be loaded.",
            );
        });
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, isLive, loadRun, attempt, currentStatus]);
  const [execution, setExecution] = useState(false);
  const notify = useFeedback();
  if (error)
    return (
      <EmptyState
        title="Run unavailable"
        description={error}
        action={
          <button
            className="button secondary"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        }
      />
    );
  if (!ready) return <WorkspaceLoading />;
  if (!w) return <WorkspaceLoading />;
  const run = w.runs.find((r) => r.id === id);
  if (!run) return <MissingRecord kind="run" />;
  const project = w.projects.find((p) => p.id === run.projectId);
  if (!project) return <MissingRecord kind="project" />;
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`);
    } catch {
      notify(
        "Clipboard access isn’t available. Select and copy the text directly.",
        "error",
      );
    }
  }
  const summary = `${data?.mode === "demo" ? "FlowGuard demo fixture" : "FlowGuard recorded result"}\nRun #${run.number}: ${run.status}\nProject: ${project.name}\nJourney: ${run.journeyName}\nCommit: ${run.commit}\n${run.assertion ? `Expected: ${run.assertion.expected}\nObserved: ${run.assertion.received}` : ""}`;
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/app/runs">Runs</Link>
            <span>/</span>
            <Link href={`/app/projects/${project.id}`}>{project.name}</Link>
            <span>/</span>
            <span className="mono">#{run.number}</span>
          </>
        }
        title={run.journeyName}
        description={
          <span className="run-heading-meta">
            <span className="mono">Run #{run.number}</span>
            <span>·</span>
            <span>
              {new Date(run.startedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </span>
        }
        action={
          <>
            <button
              className="button secondary"
              onClick={() => copy(summary, "Run summary")}
            >
              <Copy size={15} />
              Copy summary
            </button>
            <button
              className={`button ${unsuccessful(run) ? "secondary" : "primary"}`}
              onClick={() => setExecution(true)}
            >
              <Play size={15} />
              Run again
            </button>
          </>
        }
      />
      <div className={`run-result-banner result-${run.status}`}>
        <StatusIndicator
          status={run.status}
          label={
            isLive
              ? undefined
              : run.status === "failed"
                ? "Run failed"
                : run.status === "passed"
                  ? "Run passed"
                  : run.status === "running"
                    ? "Running · sample state"
                    : "Result unknown"
          }
          large
        />
        <p>
          {isLive
            ? (unsuccessful(run)
                ? "This execution did not complete successfully. Review the investigation below."
                : null) ||
              (run.status === "passed"
                ? `All ${run.steps.length} recorded steps passed.`
                : run.status === "queued"
                  ? "Waiting for the verified GitHub Actions runner to begin."
                  : run.status === "running"
                    ? "The runner has started this journey. Refreshing recorded state."
                    : "Inspect the recorded steps and failure details.")
            : run.status === "failed"
              ? `${run.steps.filter((s) => s.status === "passed").length} steps passed before the assertion failed.`
              : run.status === "passed"
                ? `All ${run.steps.length} recorded steps passed.`
                : run.status === "running"
                  ? "Static demo record. No test is currently being executed."
                  : "This sample record has no completed execution result."}
        </p>
        <span className="mono">{duration(run.duration)}</span>
        <span className="neutral-tag">
          {data?.mode === "demo" ? "Demo result" : "Recorded result"}
        </span>
      </div>
      <FailureTools key={`tools-${run.id}`} run={run} project={project} />
      {run.failureCategory && (
        <p className="info-panel">
          Failure category: {run.failureCategory.replaceAll("_", " ")}
        </p>
      )}
      {run.batchId && (
        <div className="page-actions">
          <Link className="text-link" href={`/app/executions/${run.batchId}`}>
            Execution overview
          </Link>
          {run.githubUrl && (
            <a
              className="text-link"
              href={`${run.githubUrl}#artifacts`}
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub Actions & trace artifacts
            </a>
          )}
        </div>
      )}
      <div id="evidence">
        <Investigation key={run.id} run={run} />
      </div>
      <details className="run-metadata-disclosure">
        <summary>
          <span>
            <GitCommitHorizontal size={18} />
            Execution & source<span className="mono">{run.commit}</span>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="execution-metadata">
          <dl className="execution-meta">
            {[
              ["Project", project.name],
              ["Environment", run.environment],
              ["Duration", duration(run.duration)],
              ["Browser", run.browser],
              ["Target", host(project.url)],
              ["Branch", run.branch],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd
                  className={
                    key === "Project" || key === "Environment" ? "" : "mono"
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="commit-section">
            <div className="source-item">
              <span className="mono">{run.commit}</span>
              <button
                className="icon-button"
                aria-label="Copy commit hash"
                onClick={() => copy(run.commit, "Commit hash")}
              >
                <Copy size={14} />
              </button>
            </div>
            <p>{run.commitMessage}</p>
            <span className="muted small-text">
              {isLive
                ? "Commit and branch reported by the verified GitHub workflow."
                : "Repository reference only. No GitHub connection."}
            </span>
          </div>
        </div>
      </details>
      {execution && (
        <ExecutionLauncher
          project={project}
          journeyId={run.journeyId || undefined}
          onClose={() => setExecution(false)}
        />
      )}
    </>
  );
}
