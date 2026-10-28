"use client";
import Link from "./workspace-link";
import { useWorkspaceRouter as useRouter } from "./workspace-link";
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  GitFork,
  Globe,
  Plus,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-store";
import { host, validTarget } from "@/lib/model";
import { RepositoryPicker } from "./repository-picker";
import { PageHeader, WorkspaceLoading } from "./ui";
import { errorMessage, useFeedback } from "./feedback";

export function ProjectSetup() {
  const { data, actions, isLive, info } = useWorkspace();
  const router = useRouter();
  const notify = useFeedback();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [repository, setRepository] = useState("");
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const draftKey = `flowguard.setup.draft.v2.${info?.id ?? "demo"}`;
  const contentStep = isLive && step < 2 ? 1 - step : step;
  useEffect(() => {
    if (!isLive) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(draftKey);
    } catch {
      return;
    }
    if (saved) {
      try {
        const draft = JSON.parse(saved) as Record<string, unknown>;
        if (
          typeof draft.name === "string" &&
          typeof draft.url === "string" &&
          typeof draft.savedAt === "number" &&
          Date.now() - draft.savedAt < 30 * 60_000
        ) {
          // Hydrate a user-authored draft after returning from the GitHub redirect.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setName(draft.name.slice(0, 80));
          setUrl(draft.url.slice(0, 2000));
          setRepository(
            typeof draft.repository === "string"
              ? draft.repository.slice(0, 160)
              : "",
          );
          setRepositoryId(
            typeof draft.repositoryId === "string" &&
              /^[a-f0-9-]{36}$/i.test(draft.repositoryId)
              ? draft.repositoryId
              : null,
          );
          setStep(
            typeof draft.step === "number" && [0, 1, 2].includes(draft.step)
              ? draft.step
              : 0,
          );
        }
      } catch {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* Draft storage is optional. */
        }
      }
    }
  }, [isLive, draftKey]);
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(
          draftKey,
          JSON.stringify({
            name,
            url,
            repository,
            repositoryId,
            step,
            savedAt: Date.now(),
          }),
        );
      } catch {
        /* The server connection still works if draft storage is unavailable. */
      }
    };
    window.addEventListener("flowguard:save-project-draft", save);
    return () =>
      window.removeEventListener("flowguard:save-project-draft", save);
  }, [name, url, repository, repositoryId, step, draftKey]);
  if (!data) return <WorkspaceLoading />;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const nextErrors: Record<string, string> = {};
    if (contentStep === 0) {
      if (!name.trim()) nextErrors.name = "Enter a project name.";
      if (!validTarget(url.trim()))
        nextErrors.url = "Enter a complete http:// or https:// URL.";
    }
    if (
      contentStep === 1 &&
      !isLive &&
      repository.trim() &&
      !/^[\w.-]+\/[\w.-]+$/.test(repository.trim())
    )
      nextErrors.repository =
        "Use the format owner/repository, or leave this empty.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      document.getElementById(`setup-${Object.keys(nextErrors)[0]}`)?.focus();
      return;
    }
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    submitting.current = true;
    setSaving(true);
    try {
      const project = await actions.createProject({
        name: name.trim(),
        url: url.trim(),
        repository: repository.trim(),
        repositoryId,
        description: "",
      });
      if (isLive) {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          /* Database save already succeeded. */
        }
      }
      notify(
        isLive
          ? "Project created in your workspace. Add your first journey."
          : "Project created locally. Add your first test journey.",
      );
      router.push(`/app/projects/${project.id}`);
    } catch (e) {
      notify(errorMessage(e), "error");
      submitting.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="setup-page">
      <PageHeader
        eyebrow={
          <>
            <Link href="/app/projects">Projects</Link>
            <span>/</span>
            <span>New project</span>
          </>
        }
        title="New project"
        description="Start with a website. Define what should keep working."
      />
      <div className="setup-layout">
        <aside className="setup-sidebar">
          <ol className="setup-steps">
            {(isLive
              ? ["Repository", "Project details", "Review & create"]
              : ["Project details", "Repository", "Review & create"]
            ).map((label, i) => (
              <li
                key={label}
                className={i === step ? "active" : i < step ? "complete" : ""}
                aria-current={i === step ? "step" : undefined}
              >
                <span className="step-index mono">
                  {i < step ? <Check size={14} /> : `0${i + 1}`}
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <div className="setup-note">
            <Globe size={17} />
            <p>
              {isLive ? "Your workspace, saved." : "A local setup, for now."}
              <span>
                {isLive
                  ? "Projects and journeys are saved to your account. Test execution is not connected yet."
                  : "Your project stays in this browser. Sign in for persistent projects and GitHub connections."}
              </span>
            </p>
          </div>
        </aside>
        <form className="setup-form" onSubmit={submit} noValidate>
          <div className="setup-form-content" key={step}>
            <span className="step-kicker mono">Step {step + 1} of 3</span>
            <h2>
              {
                [
                  "Give your project a home",
                  "Add repository context",
                  "Everything in the right place?",
                ][contentStep]
              }
            </h2>
            <p className="form-intro">
              {
                [
                  "Choose a name and the website you want to test.",
                  isLive
                    ? "Select a verified repository, or continue without one."
                    : "An optional reference for the code behind your website.",
                  "Review your configuration before creating the project.",
                ][contentStep]
              }
            </p>
            {contentStep === 0 && (
              <>
                <div className="field">
                  <label htmlFor="setup-name">Project name</label>
                  <input
                    id="setup-name"
                    autoFocus
                    autoComplete="off"
                    placeholder="e.g. Acme storefront"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "name-error" : undefined}
                  />
                  {errors.name && (
                    <p className="field-error" id="name-error">
                      {errors.name}
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="setup-url">Target URL</label>
                  <input
                    id="setup-url"
                    type="url"
                    autoComplete="url"
                    placeholder="https://your-project.com"
                    value={url}
                    maxLength={2000}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-invalid={!!errors.url}
                    aria-describedby={errors.url ? "url-error" : "url-hint"}
                  />
                  {errors.url ? (
                    <p className="field-error" id="url-error">
                      {errors.url}
                    </p>
                  ) : (
                    <p className="field-hint" id="url-hint">
                      Use your production website, preview deployment, or
                      localhost URL.
                    </p>
                  )}
                </div>
              </>
            )}
            {contentStep === 1 && isLive && (
              <RepositoryPicker
                value={repositoryId}
                onChange={(id, name) => {
                  setRepositoryId(id);
                  setRepository(name);
                  if (!name.trim()) return;
                  setName(
                    (previous) => previous || name.split("/").at(-1) || "",
                  );
                }}
              />
            )}
            {contentStep === 1 && !isLive && (
              <>
                <div className="integration-placeholder">
                  <GitFork size={23} strokeWidth={1.5} />
                  <div>
                    <h3>GitHub</h3>
                    <p>Sign in to connect a GitHub repository.</p>
                  </div>
                  <span className="neutral-tag">Not connected</span>
                </div>
                <div className="field">
                  <label htmlFor="setup-repository">
                    Repository <span className="optional">Optional</span>
                  </label>
                  <input
                    id="setup-repository"
                    autoFocus
                    autoComplete="off"
                    placeholder="owner/repository"
                    maxLength={160}
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                    aria-invalid={!!errors.repository}
                    aria-describedby={
                      errors.repository ? "repository-error" : "repository-hint"
                    }
                  />
                  {errors.repository ? (
                    <p className="field-error" id="repository-error">
                      {errors.repository}
                    </p>
                  ) : (
                    <p className="field-hint" id="repository-hint">
                      Saved as text only. This does not grant access to your
                      repository.
                    </p>
                  )}
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <dl className="review-list">
                  <div>
                    <dt>Project name</dt>
                    <dd>{name}</dd>
                  </div>
                  <div>
                    <dt>Target URL</dt>
                    <dd className="mono">{url}</dd>
                  </div>
                  <div>
                    <dt>Repository</dt>
                    <dd className="mono">{repository || "Not added"}</dd>
                  </div>
                  <div>
                    <dt>Workspace</dt>
                    <dd>
                      {data.mode === "demo"
                        ? "Demo workspace"
                        : isLive
                          ? info?.name
                          : "Local workspace"}
                    </dd>
                  </div>
                </dl>
                <div className="info-panel">
                  <Check size={18} />
                  <p>
                    {isLive
                      ? "This saves a project for "
                      : "This creates a local project for "}
                    <strong>{host(url)}</strong>. No tests, deployments, or
                    GitHub installation changes will be started.
                  </p>
                </div>
              </>
            )}
          </div>
          <div className="setup-form-actions">
            {step ? (
              <button
                type="button"
                className="button ghost"
                disabled={saving}
                onClick={() => {
                  setStep(step - 1);
                  setErrors({});
                }}
              >
                <ArrowLeft size={15} />
                Back
              </button>
            ) : (
              <Link className="button ghost" href="/app/projects">
                Cancel
              </Link>
            )}
            <button type="submit" className="button primary" disabled={saving}>
              {step < 2 ? (
                <>
                  Continue
                  <ArrowRight size={15} />
                </>
              ) : (
                <>
                  <Plus size={15} />
                  {saving ? "Creating…" : "Create project"}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
