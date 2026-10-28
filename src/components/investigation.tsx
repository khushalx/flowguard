"use client";
import Image from "next/image";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Copy,
  Expand,
  FileImage,
  FileText,
} from "lucide-react";
import { duration, type Run } from "@/lib/model";
import { Dialog, SectionHeading, StatusIndicator } from "./ui";
import { useFeedback } from "./feedback";

export function Investigation({
  run,
  compact = false,
}: {
  run: Run;
  compact?: boolean;
}) {
  const failureIndex = run.steps.findIndex((s) => s.status === "failed");
  const [selected, setSelected] = useState(
    failureIndex >= 0 ? failureIndex : 0,
  );
  const [expanded, setExpanded] = useState(false);
  const notify = useFeedback();
  const step = run.steps[selected];
  const showingFailure = step?.status === "failed";
  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(run.logs.join("\n"));
      notify("Logs copied.");
    } catch {
      notify(
        "Clipboard access is unavailable. You can select and copy the log text.",
        "error",
      );
    }
  }
  return (
    <div className={`investigation ${compact ? "investigation-compact" : ""}`}>
      <div className="investigation-workbench">
        <aside className="investigation-steps" aria-label="Browser steps">
          <SectionHeading title="Browser steps" count={run.steps.length} />
          {run.steps.length ? (
            <ol className="step-timeline">
              {run.steps.map((s, i) => (
                <li
                  key={`${i}-${s.name}`}
                  className={`timeline-step step-${s.status}`}
                >
                  <button
                    className="step-select"
                    onClick={() => setSelected(i)}
                    aria-pressed={selected === i}
                    aria-label={`Step ${i + 1}: ${s.name}`}
                  >
                    <span className="timeline-number mono">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="timeline-content">
                      <span className="step-name">{s.name}</span>
                      <span className="step-meta">
                        <StatusIndicator status={s.status} />
                        <span className="mono">{duration(s.duration)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="quiet-state">No step evidence was recorded.</p>
          )}
          <p className="steps-help">
            Select a step to inspect its recorded details.
          </p>
        </aside>
        <div className="investigation-evidence">
          <div className="step-detail-heading">
            <span className="eyebrow-label">
              {step
                ? `Step ${String(selected + 1).padStart(2, "0")} / ${String(run.steps.length).padStart(2, "0")}`
                : "No step data"}
            </span>
            <div className="step-pagination">
              <button
                className="icon-button"
                onClick={() => setSelected(selected - 1)}
                disabled={selected <= 0}
                aria-label="Previous step"
              >
                <ArrowLeft size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => setSelected(selected + 1)}
                disabled={selected >= run.steps.length - 1}
                aria-label="Next step"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div
            className="selected-step-detail"
            aria-live="polite"
            aria-atomic="true"
          >
            <h2>{step?.name ?? "No result was recorded"}</h2>
            <p>
              {step?.detail ??
                "This sample run does not include browser step evidence."}
            </p>
          </div>
          {showingFailure && run.assertion ? (
            <section className="failure-evidence" aria-label="Failed assertion">
              <div className="failure-summary">
                <h3>Failed assertion</h3>
                <dl className="assertion-comparison">
                  <div>
                    <dt>Expected</dt>
                    <dd>{run.assertion.expected}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{run.assertion.received}</dd>
                  </div>
                </dl>
                <details className="technical-details">
                  <summary>
                    Assertion details
                    <ChevronDown size={15} />
                  </summary>
                  <div>
                    <span className="muted small-text">Locator</span>
                    <pre>
                      <code>{run.assertion.locator}</code>
                    </pre>
                    <p className="mono small-text muted">
                      Timeout: {run.assertion.timeout.toLocaleString()}ms ·
                      Expected state: visible
                    </p>
                  </div>
                </details>
              </div>
            </section>
          ) : (
            failureIndex >= 0 && (
              <button
                className="text-link return-failure"
                onClick={() => setSelected(failureIndex)}
              >
                Return to the failed assertion
                <ArrowRight size={15} />
              </button>
            )
          )}
          {run.screenshot ? (
            <figure className="screenshot-evidence">
              <div className="evidence-toolbar">
                <span>
                  <FileImage size={15} />
                  Failure screenshot
                  <span className="mono">Step {failureIndex + 1}</span>
                </span>
                <button
                  className="icon-button"
                  onClick={() => setExpanded(true)}
                  aria-label="Expand screenshot fixture"
                  title="Expand screenshot"
                >
                  <Expand size={16} />
                </button>
              </div>
              <button
                className="screenshot-button"
                onClick={() => setExpanded(true)}
                aria-label="View illustrative screenshot fixture"
              >
                <Image
                  src={run.screenshot}
                  width={960}
                  height={540}
                  alt={`Illustrative demo screenshot for ${run.journeyName}. Observed: ${run.assertion?.received ?? "Sample page"}.`}
                  loading="eager"
                  unoptimized
                />
              </button>
              <figcaption>
                Illustrative demo fixture · not captured from a live website.
              </figcaption>
            </figure>
          ) : (
            <div className="no-screenshot">
              <FileImage size={25} strokeWidth={1.3} />
              <div>
                <h3>No screenshot attached</h3>
                <p>
                  {run.status === "passed"
                    ? "Review the recorded steps and logs for this result."
                    : "This sample record does not include a screenshot."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <details className="log-details">
        <summary>
          <span>
            <FileText size={17} />
            Execution logs<span className="count">{run.logs.length}</span>
          </span>
          <ChevronDown size={16} />
        </summary>
        <div className="log-content">
          <div className="log-toolbar">
            <span className="mono">Sample log output</span>
            <button className="text-link" onClick={copyLogs}>
              <Copy size={14} />
              Copy logs
            </button>
          </div>
          <pre tabIndex={0} aria-label="Execution log output">
            <code>{run.logs.join("\n")}</code>
          </pre>
        </div>
      </details>
      {expanded && run.screenshot && (
        <Dialog
          title="Screenshot fixture"
          description="Illustrative demo evidence. This is not a screenshot from a real test execution."
          onClose={() => setExpanded(false)}
          wide
        >
          <div className="evidence-expanded">
            <Image
              src={run.screenshot}
              width={960}
              height={540}
              alt={`Expanded demo screenshot for ${run.journeyName}.`}
              unoptimized
            />
          </div>
          <div className="dialog-actions">
            <a
              className="button secondary"
              download="flowguard-demo-evidence.svg"
              href={run.screenshot}
            >
              Download fixture
            </a>
            <button
              className="button primary"
              onClick={() => setExpanded(false)}
            >
              Done
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
