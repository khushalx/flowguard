"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ArrowRight } from "lucide-react";
import {
  compareHistory,
  explain,
  fixPrompt,
  unsuccessful,
} from "@/lib/investigation/evidence";
import type { Analysis } from "@/lib/investigation/ai";
import type { Project, Run } from "@/lib/model";
import type { RunReport } from "@/lib/server/reports";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import { appOrigin } from "@/lib/env";
import { duration } from "@/lib/model";
import { Dialog, StatusIndicator } from "./ui";
import Link from "./workspace-link";
import { useFeedback, errorMessage } from "./feedback";
export function FailureTools({ run, project }: { run: Run; project: Project }) {
  const { isLive, workspace, basePath, info } = useWorkspace(),
    notify = useFeedback();
  const [panel, setPanel] = useState<
    "prompt" | "compare" | "analysis" | "issue" | null
  >(null);
  const [report, setReport] = useState<RunReport | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<{
    analysis: Analysis;
    cached: boolean;
    usage: { input: number; output: number; estimatedUsd: number };
  } | null>(null);
  const [issue, setIssue] = useState<{
    available: boolean;
    message?: string;
    url?: string;
    body?: string;
    bodyHash?: string;
  } | null>(null);
  const [verify, setVerify] = useState(false),
    [grouped, setGrouped] = useState(true);
  if (!unsuccessful(run) && !run.verificationOf) return null;
  const canEdit = !isLive || ["owner", "admin"].includes(info?.role || "");
  const summary = explain(run),
    prompt =
      fixPrompt(
        run,
        project,
        isLive ? `${appOrigin()}${basePath}` : basePath,
      ) || "";
  const comparison =
    report?.comparison ||
    (!isLive ? compareHistory(run, workspace?.runs || []) : null);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`);
    } catch {
      setPanel("prompt");
      notify("Select the preview text to copy it.", "error");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([prompt], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowguard-run-${run.number}-fix.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function open(next: typeof panel) {
    setPanel(next);
    setError(null);
    if (isLive && (next === "compare" || next === "analysis") && !report) {
      setBusy(true);
      try {
        setReport(await apiRequest(`/api/runs/${run.id}/report`));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    }
  }
  async function analyze() {
    if (!report || busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnalysis(
        await apiRequest(`/api/runs/${run.id}/analysis`, {
          reviewedHash: report.ai.evidenceHash,
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function issueAction(action: "check" | "create") {
    setBusy(true);
    setError(null);
    try {
      setIssue(
        await apiRequest(`/api/runs/${run.id}/issue`, {
          action,
          ...(action === "create" ? { reviewedHash: issue?.bodyHash } : {}),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="failure-report" aria-label="Failure investigation">
      {unsuccessful(run) && (
        <>
          <div className="failure-heading">
            <span className="muted">What failed</span>
            <h2>{summary.summary}</h2>
            <p>{summary.next}</p>
          </div>
          <dl className="failure-plain">
            <div>
              <dt>Expected</dt>
              <dd>{summary.expected}</dd>
            </div>
            <div>
              <dt>Observed</dt>
              <dd>{summary.observed}</dd>
            </div>
          </dl>
          <div className="page-actions">
            <button
              className="button primary"
              onClick={() => copy(prompt, "Fix prompt")}
            >
              <Copy size={15} />
              Copy fix prompt
            </button>
            {isLive && canEdit && run.analysisAvailable && (
              <button
                className="button secondary"
                onClick={() => open("analysis")}
              >
                Analyze failure
              </button>
            )}
            <a className="button secondary" href="#evidence">
              View evidence
            </a>
            <button
              className="button secondary"
              onClick={() => open("compare")}
            >
              Compare runs
            </button>
            {isLive && canEdit && run.snapshot && run.journeyId && (
              <button
                className="button secondary"
                onClick={() => setVerify(true)}
              >
                Verify fix
              </button>
            )}
          </div>
          {!run.analysisAvailable && (
            <p className="muted small-text">
              Optional AI analysis is not configured. Fix prompts use recorded
              evidence and need no API key.
            </p>
          )}
          <details className="technical-details">
            <summary>More investigation actions</summary>
            <div className="page-actions">
              <button className="text-link" onClick={() => open("prompt")}>
                Preview prompt
              </button>
              <button className="text-link" onClick={download}>
                <Download size={14} />
                Download Markdown
              </button>
              <button
                className="text-link"
                onClick={() => {
                  setIssue(null);
                  open("issue");
                }}
              >
                GitHub issue
              </button>
            </div>
          </details>
          {summary.missing.length > 0 && (
            <details className="technical-details">
              <summary>Missing evidence ({summary.missing.length})</summary>
              <ul>
                {summary.missing.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {run.verificationOf && (
        <p className="info-panel">
          This run preserves a verification link to{" "}
          <Link href={`/app/runs/${run.verificationOf}`} className="text-link">
            the original failure <ArrowRight size={14} />
          </Link>
          . Open its comparison to see whether the original assertion was
          verified.
        </p>
      )}
      {panel && (
        <Dialog
          title={
            panel === "prompt"
              ? "Fix prompt"
              : panel === "compare"
                ? "Compare with last passing run"
                : panel === "analysis"
                  ? "Review optional analysis data"
                  : "GitHub issue"
          }
          description={
            panel === "analysis"
              ? "Only the evidence below will be sent to OpenAI. No screenshot, trace, input value, source code, account data or repository name is included. Output is a hypothesis, never a confirmed diagnosis."
              : undefined
          }
          onClose={() => {
            if (!busy) setPanel(null);
          }}
          wide
        >
          {busy && (
            <p role="status">
              {panel === "analysis" && report
                ? "Analyzing reviewed evidence…"
                : "Loading…"}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {panel === "prompt" && (
            <>
              <pre className="prompt-preview" tabIndex={0}>
                {prompt}
              </pre>
              <div className="dialog-actions">
                <button className="button secondary" onClick={download}>
                  Download Markdown
                </button>
                <button
                  className="button primary"
                  onClick={() => copy(prompt, "Fix prompt")}
                >
                  Copy fix prompt
                </button>
              </div>
            </>
          )}
          {panel === "compare" && comparison && (
            <div className="comparison-body">
              <p>{comparison.warning}</p>
              {comparison.truncated && (
                <p className="info-panel">
                  Only the latest 100 runs of this saved check were examined.
                  First-seen times and occurrence counts describe this window,
                  not the entire history.
                </p>
              )}
              {comparison.passing && (
                <>
                  <dl className="failure-plain">
                    <div>
                      <dt>Last comparable success</dt>
                      <dd>
                        <Link
                          className="text-link"
                          href={`/app/runs/${comparison.passing.id}`}
                        >
                          Run #{comparison.passing.number}
                        </Link>
                        <p className="mono">
                          {comparison.passing.commit || "Commit unavailable"}
                        </p>
                      </dd>
                    </div>
                    <div>
                      <dt>First failure after that success</dt>
                      <dd>
                        {comparison.firstFailure ? (
                          <Link
                            className="text-link"
                            href={`/app/runs/${comparison.firstFailure.id}`}
                          >
                            Run #{comparison.firstFailure.number}
                          </Link>
                        ) : (
                          "Not recorded"
                        )}
                        <p className="mono">
                          {comparison.firstFailure?.commit ||
                            "Commit unavailable"}
                        </p>
                      </dd>
                    </div>
                  </dl>
                  <p>
                    Duration difference:{" "}
                    {comparison.durationDelta === null
                      ? "Not recorded"
                      : `${comparison.durationDelta >= 0 ? "+" : "−"}${duration(Math.abs(comparison.durationDelta))}`}
                  </p>
                  {comparison.assertionChange && (
                    <p className="muted">{comparison.assertionChange}</p>
                  )}
                  {comparison.stepChanges.length > 0 && (
                    <ul>
                      {comparison.stepChanges.map((s) => (
                        <li key={s.step}>
                          Step {s.step}: {s.name} — {s.before} → {s.after}
                        </li>
                      ))}
                    </ul>
                  )}
                  {comparison.commitUrl && (
                    <a
                      className="text-link"
                      href={comparison.commitUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Review GitHub changes <ArrowRight size={14} />
                    </a>
                  )}
                </>
              )}
              {comparison.group && (
                <section className="section">
                  <div className="section-heading">
                    <h3>Related failures · {comparison.group.count}</h3>
                    <button
                      className="text-link"
                      onClick={() => setGrouped(!grouped)}
                    >
                      {grouped
                        ? "Show individual occurrences"
                        : "Group occurrences"}
                    </button>
                  </div>
                  <p className="muted">
                    Matched saved check, environment, category, failed step,
                    assertion and sanitized error. This is an evidence grouping,
                    not a confirmed shared cause.
                  </p>
                  <p>
                    First seen{" "}
                    {new Date(comparison.group.firstSeen).toLocaleString()} ·
                    Last seen{" "}
                    {new Date(comparison.group.lastSeen).toLocaleString()}
                  </p>
                  {(!grouped || comparison.group.count <= 3) && (
                    <ul>
                      {comparison.group.runs.map((r) => (
                        <li key={r.id}>
                          <Link
                            href={`/app/runs/${r.id}`}
                            className="text-link"
                          >
                            Run #{r.number}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p>
                    Most recent successful verification:{" "}
                    {comparison.group.verified ? (
                      <Link href={`/app/runs/${comparison.group.verified.id}`}>
                        Run #{comparison.group.verified.number}
                      </Link>
                    ) : (
                      "None recorded"
                    )}
                  </p>
                </section>
              )}
              {comparison.verifications.length > 0 && (
                <section className="section">
                  <h3>Fix verifications</h3>
                  {comparison.verifications.map((r) => (
                    <div className="verification-result" key={r.id}>
                      <Link className="text-link" href={`/app/runs/${r.id}`}>
                        Run #{r.number}
                      </Link>
                      <StatusIndicator status={r.status as Run["status"]} />
                      <p>{r.reason}</p>
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}
          {panel === "analysis" && report && (
            <>
              <dl className="analysis-evidence">
                {report.ai.evidence.map((e) => (
                  <div key={e.id}>
                    <dt>{e.id}</dt>
                    <dd>{e.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small-text">
                Maximum 1,200 output tokens. Workspace limits: 5
                requests/minute, 20/day, $1 reserved/day. This is an optional
                metered API request.
              </p>
              {!analysis && (
                <button
                  className="button primary"
                  disabled={busy || !report.ai.enabled}
                  onClick={analyze}
                >
                  Send reviewed evidence
                </button>
              )}
              {analysis && (
                <section className="section">
                  <h3>AI hypotheses</h3>
                  <p>{analysis.analysis.summary}</p>
                  {analysis.analysis.hypotheses.map((h, i) => (
                    <div className="verification-result" key={i}>
                      <h4>Possible cause: {h.cause}</h4>
                      <p className="mono small-text">
                        Evidence: {h.evidenceIds.join(", ")}
                      </p>
                      <p>{h.investigation}</p>
                    </div>
                  ))}
                  <h4>Recommended verification</h4>
                  <ul>
                    {analysis.analysis.verification.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                  <p className="muted small-text">
                    {analysis.cached ? "Cached result" : "New analysis"} ·{" "}
                    {analysis.usage.input} input / {analysis.usage.output}{" "}
                    output tokens · estimated $
                    {Number(analysis.usage.estimatedUsd || 0).toFixed(6)}
                  </p>
                </section>
              )}
            </>
          )}
          {panel === "issue" && (
            <>
              <p>
                Review this sanitized body before sharing it with your
                repository. It contains test evidence and a workspace-protected
                report link.
              </p>
              <pre className="prompt-preview" tabIndex={0}>
                {issue?.body || prompt}
              </pre>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  onClick={() => copy(issue?.body || prompt, "Issue body")}
                >
                  Copy issue body
                </button>
                {isLive && canEdit && !issue && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => issueAction("check")}
                  >
                    Check Issues permission
                  </button>
                )}
                {issue?.available && !issue.url && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => issueAction("create")}
                  >
                    Create GitHub Issue
                  </button>
                )}
                {issue?.url && (
                  <a
                    className="button secondary"
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open GitHub Issue
                  </a>
                )}
              </div>
              {issue?.message && <p className="info-panel">{issue.message}</p>}
            </>
          )}
        </Dialog>
      )}
      {verify && <VerifyFix run={run} onClose={() => setVerify(false)} />}
    </section>
  );
}
function VerifyFix({ run, onClose }: { run: Run; onClose: () => void }) {
  const router = useRouter();
  const [custom, setCustom] = useState(false),
    [target, setTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest("/api/executions", {
        action: "run",
        projectId: run.projectId,
        requestId,
        verificationOf: run.id,
        ...(custom ? { targetUrl: target } : {}),
      });
      router.push(`/app/executions/${result.id}`);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Verify fix"
      description="Rerun the original immutable check through the existing secure runner. The previous result is preserved."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="form-stack">
        <p>
          Check: {run.journeyName} · version{" "}
          <span className="mono">{run.snapshot?.fingerprint.slice(0, 12)}</span>
        </p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={custom}
            disabled={busy}
            onChange={(e) => {
              setCustom(e.target.checked);
              setRequestId(crypto.randomUUID());
            }}
          />
          Choose a different deployment URL
        </label>
        {custom ? (
          <label>
            Deployment URL
            <input
              type="url"
              required
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
              placeholder="https://preview.example.com"
            />
          </label>
        ) : (
          <p>Original environment: {run.snapshot?.target}</p>
        )}
        <p className="info-panel">
          A different environment produces an inconclusive verification. A
          passing run resolves an application regression only when the original
          assertion and all required steps pass with comparable configuration.
          The workflow tests the deployed URL on the current repository default
          branch.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Queuing…" : "Run saved check"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
