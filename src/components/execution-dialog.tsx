"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCw } from "lucide-react";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import type { Project } from "@/lib/model";
import { Dialog, ExecutionDialog, ConfirmDialog } from "./ui";
import { errorMessage, useFeedback } from "./feedback";
type Setup = {
  ready: boolean;
  credentialConfigured: boolean;
  validJourneys: { id: string; name: string }[];
  skipped: { name: string; reason: string }[];
  message: string | null;
};
export function ExecutionLauncher(props: {
  project: Project;
  journeyId?: string;
  onClose: () => void;
}) {
  const { isLive } = useWorkspace();
  return isLive ? (
    <LiveExecutionDialog {...props} />
  ) : (
    <ExecutionDialog onClose={props.onClose} />
  );
}
function LiveExecutionDialog({
  project,
  journeyId,
  onClose,
}: {
  project: Project;
  journeyId?: string;
  onClose: () => void;
}) {
  const { info } = useWorkspace();
  const router = useRouter();
  const notify = useFeedback();
  const [setup, setSetup] = useState<Setup | null>(null),
    [error, setError] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [pending, setPending] = useState(false),
    [credential, setCredential] = useState<string | null>(null),
    [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const requestId = useRef<string>("");
  const busy = useRef(false);
  useEffect(() => {
    let active = true;
    apiRequest(`/api/executions?projectId=${project.id}`)
      .then((data) => {
        if (active) {
          setSetup(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [project.id, attempt]);
  const journeys =
    setup?.validJourneys.filter((j) => !journeyId || j.id === journeyId) || [];
  async function trigger() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await apiRequest("/api/executions", {
        action: "run",
        projectId: project.id,
        requestId: requestId.current,
        ...(journeyId ? { journeyIds: [journeyId] } : {}),
      });
      router.push(`/app/executions/${result.id}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog
      title="Run tests"
      description="Execute saved assertions in your repository's GitHub Actions environment."
      onClose={() => {
        if (!busy.current) onClose();
      }}
      wide
    >
      <dl className="execution-meta">
        <div>
          <dt>Target</dt>
          <dd className="mono">{project.url}</dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd className="mono">{project.repository || "Not connected"}</dd>
        </div>
        <div>
          <dt>Journeys</dt>
          <dd>{setup ? journeys.length : "Checking…"}</dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>Chromium</dd>
        </div>
      </dl>
      {!setup && !error && (
        <p role="status">
          Checking journeys, runner credential and GitHub Actions setup…
        </p>
      )}
      {setup?.message && <p className="info-panel">{setup.message}</p>}
      {setup && journeys.length === 0 && (
        <p className="field-error">
          No enabled, configured journeys are available for this selection. Add
          structured steps and a positive assertion first.
        </p>
      )}
      {journeys.length > 5 && (
        <p className="field-error">
          The initial engine runs at most five journeys per batch. Run an
          individual journey or disable additional journeys.
        </p>
      )}
      {!!setup?.skipped.length && (
        <details className="technical-details">
          <summary>{setup.skipped.length} skipped journey definitions</summary>
          <ul>
            {setup.skipped.map((j) => (
              <li key={j.name}>
                {j.name}: {j.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="technical-details">
        <summary>Runner setup</summary>
        <ol>
          <li>
            Enable repository Actions: write on the GitHub App, then approve the
            installation update.
          </li>
          <li>
            <a
              href="/flowguard-workflow.yml"
              download="flowguard.yml"
              className="text-link"
            >
              Download the workflow
            </a>{" "}
            and add it as <code>.github/workflows/flowguard.yml</code> on the
            default branch.
          </li>
          <li>
            Set repository variables <code>FLOWGUARD_URL</code> and{" "}
            <code>FLOWGUARD_RUNNER_REV</code> (a reviewed, immutable runner
            commit). The source repository must be readable by the workflow; for
            private source, use the{" "}
            <a
              href="/flowguard-workflow-vendored.yml"
              download="flowguard.yml"
              className="text-link"
            >
              vendored workflow
            </a>{" "}
            and copy only the standalone runner snapshot.
          </li>
          <li>
            Save the credential below as the repository Actions secret{" "}
            <code>FLOWGUARD_RUNNER_TOKEN</code>. Map required{" "}
            <code>FG_TEST_</code> secrets in the workflow.
          </li>
        </ol>
        <p className="field-hint">
          Credentials expire after 90 days. Rotating or revoking cancels active
          FlowGuard executions. Only the workspace owner can manage them.
        </p>
        {info?.role === "owner" && (
          <div className="page-actions">
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => setConfirm("rotate")}
            >
              {setup?.credentialConfigured
                ? "Rotate runner credential"
                : "Create runner credential"}
            </button>
            {setup?.credentialConfigured && (
              <button
                className="button secondary"
                type="button"
                disabled={pending}
                onClick={() => setConfirm("revoke")}
              >
                Revoke credential
              </button>
            )}
          </div>
        )}
        {credential && (
          <div className="field">
            <label htmlFor="new-runner-credential">
              Runner credential — shown once
            </label>
            <input
              id="new-runner-credential"
              type="password"
              readOnly
              value={credential}
              autoComplete="off"
            />
            <p className="field-hint">
              Keep this private. It is not saved in browser storage and cannot
              be retrieved after closing.
            </p>
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(credential);
                  notify(
                    "Runner credential copied. Save it in GitHub repository Actions secrets.",
                  );
                } catch {
                  notify(
                    "Clipboard is unavailable. Select and copy the credential field.",
                    "error",
                  );
                }
              }}
            >
              Copy credential
            </button>
          </div>
        )}
        <p className="field-hint">
          GitHub Actions usage depends on your repository plan and quota. Tests
          do not check out or execute forked pull-request code.
        </p>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button
          className="button secondary"
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCw size={14} />
          Check setup again
        </button>
        <button
          className="button primary"
          type="button"
          disabled={
            pending || !setup?.ready || !journeys.length || journeys.length > 5
          }
          onClick={trigger}
        >
          <Play size={14} />
          {pending
            ? "Dispatching…"
            : `Run ${journeys.length} ${journeys.length === 1 ? "journey" : "journeys"}`}
        </button>
      </div>
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "rotate"
              ? "Create a new runner credential?"
              : "Revoke runner access?"
          }
          description="Any active FlowGuard execution for this project will be cancelled. Update the repository secret before running again."
          confirmLabel={
            confirm === "rotate" ? "Generate credential" : "Revoke credential"
          }
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              const data = await apiRequest("/api/executions", {
                action: confirm,
                projectId: project.id,
              });
              setCredential(data.credential ?? null);
              setConfirm(null);
              setAttempt((n) => n + 1);
              notify(
                data.credential
                  ? "Credential generated. Save it in GitHub Actions secrets."
                  : "Runner credential revoked.",
              );
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      )}
    </Dialog>
  );
}
