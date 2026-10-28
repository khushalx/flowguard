"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, Play, RotateCw } from "lucide-react";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import type { Project } from "@/lib/model";
import { Dialog, ConfirmDialog, ExecutionDialog } from "./ui";
import { errorMessage, useFeedback } from "./feedback";
import { QuickCheck } from "./quick-check";
import { StructuredJourneyEditor } from "./structured-journey-editor";
import Link from "./workspace-link";

type Setup = {
  ready: boolean;
  workflowReady: boolean;
  credentialConfigured: boolean;
  validJourneys: { id: string; name: string }[];
  skipped: { name: string; reason: string }[];
  message: string | null;
  installation: {
    workflow: string;
    workflowUrl: string;
    secretsUrl: string;
    repository: string;
    branch: string;
  } | null;
};
export function ExecutionLauncher({
  project,
  journeyId,
  autoRun = false,
  onClose,
}: {
  project: Project;
  journeyId?: string;
  autoRun?: boolean;
  onClose: () => void;
}) {
  const { info, workspace, isLive } = useWorkspace();
  const router = useRouter();
  const notify = useFeedback();
  const savedChecks =
    workspace?.journeys.filter((j) => j.projectId === project.id) || [];
  const [creating, setCreating] = useState(
    !journeyId &&
      (isLive
        ? !savedChecks.some((j) => j.enabled !== false && j.definition)
        : !savedChecks.length),
  );
  const [demoCreated, setDemoCreated] = useState(false);
  const [custom, setCustom] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(true);
  const [selected, setSelected] = useState<string[] | null>(
    journeyId ? [journeyId] : null,
  );
  const [credential, setCredential] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "revoke" | null>(null);
  const requestId = useRef("");
  const busy = useRef(false);
  const autoStart = useRef(
    autoRun &&
      isLive &&
      savedChecks.some((j) => j.enabled !== false && j.definition),
  );
  useEffect(() => {
    if (!isLive || creating || custom) return;
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
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [project.id, attempt, creating, custom, isLive]);
  const available = setup?.validJourneys || [];
  const ids = selected || available.slice(0, 5).map((j) => j.id);
  const checks = available.filter((j) => ids.includes(j.id));
  const checkIds = checks.map((j) => j.id).join(",");
  const owner = info?.role === "owner";
  const connecting = setup && (!setup.ready || (credential && !keySaved));
  function refresh() {
    setChecking(true);
    setError(null);
    setAttempt((n) => n + 1);
  }
  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Select the text below to copy it.", "error");
    }
  }
  const trigger = useCallback(async () => {
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
        journeyIds: checkIds.split(",").filter(Boolean),
      });
      router.push(`/app/executions/${result.id}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, [checkIds, project.id, onClose, router, setPending, setError]);
  useEffect(() => {
    if (
      autoStart.current &&
      setup?.ready &&
      !creating &&
      !custom &&
      checks.length &&
      (journeyId || available.length <= 5)
    ) {
      autoStart.current = false;
      void trigger();
    }
  }, [
    setup?.ready,
    creating,
    custom,
    checks.length,
    available.length,
    journeyId,
    trigger,
  ]);
  if (custom)
    return (
      <StructuredJourneyEditor
        project={project}
        journey={
          journeyId ? savedChecks.find((j) => j.id === journeyId) : undefined
        }
        onClose={() => {
          setCustom(false);
          refresh();
        }}
        onSaved={(journey) => {
          setSelected([journey.id]);
          setCreating(false);
          setCustom(false);
          refresh();
        }}
      />
    );
  if (!isLive && !creating && !demoCreated)
    return <ExecutionDialog onClose={onClose} />;
  const title = creating
    ? "Run your first check"
    : !isLive
      ? "Demo check saved"
      : connecting
        ? "Connect your runner"
        : "Run a check";
  return (
    <Dialog
      title={title}
      description={
        creating
          ? "Start with one page. You can add more checks later."
          : connecting
            ? "A one-time connection lets checks run in your GitHub account."
            : undefined
      }
      onClose={() => {
        if (!busy.current && !pending) onClose();
      }}
    >
      <div className="check-target">
        <span className="status-dot" />
        <span>{project.url}</span>
      </div>
      {creating ? (
        <QuickCheck
          project={project}
          onCustom={() => setCustom(true)}
          onSaved={(journey) => {
            setSelected([journey.id]);
            setDemoCreated(!isLive);
            setCreating(false);
            refresh();
          }}
        />
      ) : !isLive ? (
        <>
          <p className="check-description">
            Your check is saved locally. The demo cannot execute it; no result
            has been created.
          </p>
          <div className="dialog-actions">
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : checking ? (
        <p className="check-loading" role="status">
          Checking your connection…
        </p>
      ) : !setup ? (
        <>
          <p role="alert" className="form-error">
            {error || "Connection could not be checked."}
          </p>
          <div className="dialog-actions">
            <button className="button primary" onClick={refresh}>
              Try again
            </button>
          </div>
        </>
      ) : connecting ? (
        <>
          <ol className="runner-progress" aria-label="Connection progress">
            <li aria-current={!setup.workflowReady ? "step" : undefined}>
              <span>{setup.workflowReady ? <Check size={14} /> : "1"}</span>Add
              runner
            </li>
            <li aria-current={setup.workflowReady ? "step" : undefined}>
              <span>
                {setup.credentialConfigured && !credential ? (
                  <Check size={14} />
                ) : (
                  "2"
                )}
              </span>
              Connect securely
            </li>
          </ol>
          {!setup.workflowReady ? (
            <div className="runner-install-step">
              <h3>Add the runner to your repository</h3>
              <p>
                Open the prepared file in GitHub, review it and commit it to{" "}
                <strong>
                  {setup.installation?.branch || "the default branch"}
                </strong>
                . The URL and runner version are already filled in.
              </p>
              {setup.installation ? (
                <>
                  <a
                    className="button primary"
                    href={setup.installation.workflowUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open prepared file in GitHub <ArrowUpRight size={15} />
                  </a>
                  <p className="field-hint">{setup.installation.repository}</p>
                </>
              ) : (
                <Link
                  className="button primary"
                  href={`/app/projects/${project.id}?settings=repository`}
                  onClick={onClose}
                >
                  Connect a repository <ArrowUpRight size={15} />
                </Link>
              )}
              <div className="dialog-actions">
                <button className="button secondary" onClick={refresh}>
                  <RotateCw size={14} />
                  Check connection
                </button>
              </div>
            </div>
          ) : (
            <div className="runner-install-step">
              <h3>Save your connection key in GitHub</h3>
              <p>
                This lets your runner send results back to FlowGuard. You only
                need to do this once.
              </p>
              {!owner ? (
                <p className="info-panel">
                  Ask your workspace owner to connect the runner. Your check is
                  saved.
                </p>
              ) : credential ? (
                <>
                  <div className="field">
                    <label htmlFor="runner-key">
                      Connection key — shown once
                    </label>
                    <div className="runner-key-field">
                      <input
                        id="runner-key"
                        type="password"
                        readOnly
                        autoComplete="off"
                        value={credential}
                      />
                      <button
                        className="button secondary"
                        onClick={() =>
                          copy(credential, "Connection key copied.")
                        }
                      >
                        <Copy size={14} />
                        Copy key
                      </button>
                    </div>
                  </div>
                  <p>
                    Open GitHub secrets, name the secret{" "}
                    <code>FLOWGUARD_RUNNER_TOKEN</code>, paste the key and save.
                  </p>
                  <a
                    className="text-link"
                    href={setup.installation?.secretsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open GitHub secrets <ArrowUpRight size={14} />
                  </a>
                  <div className="dialog-actions">
                    <button
                      className="button primary"
                      onClick={() => {
                        setKeySaved(true);
                        refresh();
                      }}
                    >
                      I’ve saved the key <ArrowUpRight size={14} />
                    </button>
                  </div>
                </>
              ) : (
                <div className="dialog-actions">
                  <button
                    className="button primary"
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      setError(null);
                      try {
                        const result = await apiRequest("/api/executions", {
                          action: "rotate",
                          projectId: project.id,
                        });
                        setCredential(result.credential);
                        setKeySaved(false);
                      } catch (e) {
                        setError(errorMessage(e));
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {pending ? "Generating…" : "Generate connection key"}
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="field-hint">
            Your check is saved. You can close this and return whenever you’re
            ready.
          </p>
        </>
      ) : (
        <>
          <div className="ready-check">
            <span className="ready-check-icon">
              <Check size={18} />
            </span>
            <div>
              <strong>
                {checks.length ? "Ready to run" : "Choose a check"}
              </strong>
              <p>
                {checks.length === 1
                  ? checks[0].name
                  : `${checks.length} saved checks selected`}
              </p>
            </div>
          </div>
          {!checks.length && (
            <p className="info-panel">
              Choose a saved check, or add a new one below.
            </p>
          )}
          {(available.length > 1 ||
            (available.length > 0 && !checks.length)) && (
            <details
              className="technical-details"
              open={checks.length === 0 || available.length > 5}
            >
              <summary>Choose checks ({checks.length} selected)</summary>
              <p className="field-hint">Run up to five checks at once.</p>
              <div className="run-check-list">
                {available.map((j) => (
                  <label key={j.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(j.id)}
                      disabled={!ids.includes(j.id) && checks.length >= 5}
                      onChange={(e) => {
                        setSelected(
                          e.target.checked
                            ? [...ids, j.id]
                            : ids.filter((id) => id !== j.id),
                        );
                        requestId.current = "";
                      }}
                    />
                    {j.name}
                  </label>
                ))}
              </div>
            </details>
          )}
          <p className="check-description">
            We’ll open the page in Chromium and check the saved expectations.
            The report appears when execution finishes.
          </p>
          <div className="dialog-actions check-form-actions">
            <button className="text-link" onClick={() => setCreating(true)}>
              Add a check
            </button>
            <button
              className="button primary"
              disabled={pending || !checks.length}
              onClick={trigger}
            >
              <Play size={14} />
              {pending
                ? "Starting…"
                : checks.length > 1
                  ? `Run ${checks.length} checks`
                  : "Run check"}
            </button>
          </div>
        </>
      )}
      {setup && !creating && isLive && (
        <details className="technical-details runner-advanced">
          <summary>
            {connecting ? "Connection help" : "Advanced connection settings"}
          </summary>
          {setup.skipped.length > 0 && (
            <>
              <p>{setup.skipped.length} checks aren’t ready to run.</p>
              {journeyId && !available.some((j) => j.id === journeyId) && (
                <button className="text-link" onClick={() => setCustom(true)}>
                  Edit check
                </button>
              )}
            </>
          )}
          {setup.message && <p>{setup.message}</p>}
          {!setup.workflowReady && setup.installation && (
            <>
              <p>
                If the GitHub editor is unavailable, add this file as{" "}
                <code>.github/workflows/flowguard.yml</code> on the default
                branch.
              </p>
              <button
                className="text-link"
                onClick={() =>
                  copy(setup.installation!.workflow, "Workflow copied.")
                }
              >
                Copy workflow
              </button>
              <pre className="prompt-preview" tabIndex={0}>
                {setup.installation.workflow}
              </pre>
            </>
          )}
          <p>
            GitHub Actions usage follows your GitHub plan. Connection keys
            expire after 90 days.
          </p>
          {owner && setup.credentialConfigured && (
            <div className="page-actions">
              <button
                className="text-link"
                disabled={pending}
                onClick={() => setConfirm("rotate")}
              >
                Replace connection key
              </button>
              <button
                className="text-link"
                disabled={pending}
                onClick={() => setConfirm("revoke")}
              >
                Disconnect runner
              </button>
            </div>
          )}
        </details>
      )}
      {error && setup && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "rotate"
              ? "Replace the connection key?"
              : "Disconnect the runner?"
          }
          description="Active executions will be cancelled. Replacing the key also requires updating its GitHub secret."
          confirmLabel={confirm === "rotate" ? "Replace key" : "Disconnect"}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              const result = await apiRequest("/api/executions", {
                action: confirm,
                projectId: project.id,
              });
              setCredential(result.credential || null);
              setKeySaved(false);
              setConfirm(null);
              refresh();
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      )}
    </Dialog>
  );
}
