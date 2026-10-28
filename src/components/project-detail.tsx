"use client";
import Link from "./workspace-link";
import { useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  GitFork,
  Globe,
  ListChecks,
  Play,
  Plus,
  Settings2,
} from "lucide-react";
import { duration, host, latestRun, relativeTime } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import {
  MissingRecord,
  PageHeader,
  SectionHeading,
  StatusIndicator,
  TextLink,
  WorkspaceLoading,
} from "./ui";
import { JourneyEditor, JourneysList } from "./journeys";
import { connectionLabels } from "./repository-picker";
import { ProjectSettings } from "./project-settings";
import { ProjectAvatar, RunList } from "./rows";
import { ExecutionLauncher } from "./execution-dialog";
import { explain, unsuccessful } from "@/lib/investigation/evidence";
export function ProjectDetail({
  id,
  journeysOnly = false,
  initialSettings = false,
}: {
  id: string;
  journeysOnly?: boolean;
  initialSettings?: boolean;
}) {
  const { workspace: w, data, repositories, isLive } = useWorkspace();
  const [execution, setExecution] = useState(false);
  const [editor, setEditor] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  if (!w) return <WorkspaceLoading />;
  const project = w.projects.find((p) => p.id === id);
  if (!project) return <MissingRecord />;
  const journeys = w.journeys.filter((j) => j.projectId === id);
  const runs = w.runs
    .filter((r) => r.projectId === id)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const latest = latestRun(runs, id);
  const current = journeys
    .map((j) => latestRun(runs, id, j.id))
    .filter((r) => !!r);
  const problems = current.filter(unsuccessful);
  const untested = journeys.length - current.length;
  return (
    <>
      <PageHeader
        leading={!journeysOnly && <ProjectAvatar project={project} />}
        eyebrow={
          <>
            <Link href="/app/projects">Projects</Link>
            <span>/</span>
            {journeysOnly ? (
              <>
                <Link href={`/app/projects/${id}`}>{project.name}</Link>
                <span>/</span>
                <span>Journeys</span>
              </>
            ) : (
              <span>{project.name}</span>
            )}
          </>
        }
        title={journeysOnly ? "Test journeys" : project.name}
        description={
          journeysOnly
            ? `The workflows that matter to ${project.name}.`
            : project.description ||
              "Project configuration and recorded test results."
        }
        action={
          journeysOnly ? (
            journeys.length > 0 && (
              <button
                className="button primary"
                onClick={() => setEditor(true)}
              >
                <Plus size={16} />
                Create journey
              </button>
            )
          ) : (
            <>
              <button
                className="button secondary"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={15} />
                <span>Settings</span>
              </button>
              <button
                className="button primary"
                onClick={() => setExecution(true)}
              >
                <Play size={14} />
                Run a check
              </button>
            </>
          )
        }
      />
      {!journeysOnly && (
        <div className="project-context">
          <span className="project-url">
            <Globe size={14} />
            {data?.mode === "demo" &&
            host(project.url).endsWith("example.com") ? (
              <span className="mono">{host(project.url)}</span>
            ) : (
              <a
                className="mono"
                href={project.url}
                target="_blank"
                rel="noreferrer"
              >
                {host(project.url)}
                <ExternalLink size={12} />
              </a>
            )}
          </span>
          <span className="project-repository">
            <GitFork size={14} />
            <span className="mono">
              {project.repository || "No repository"}
            </span>
            <span className="neutral-tag">
              {isLive && project.repositoryId
                ? connectionLabels[
                    repositories.find((r) => r.id === project.repositoryId)
                      ?.status ?? "access_required"
                  ]
                : "Not connected"}
            </span>
          </span>
        </div>
      )}
      <nav className="project-tabs" aria-label="Project navigation">
        <Link
          href={`/app/projects/${id}`}
          aria-current={!journeysOnly ? "page" : undefined}
        >
          Overview
        </Link>
        <Link
          href={`/app/projects/${id}/journeys`}
          aria-current={journeysOnly ? "page" : undefined}
        >
          Journeys <span className="count">{journeys.length}</span>
        </Link>
      </nav>
      {!journeysOnly && (
        <section
          className="project-health section"
          aria-label="Current project health"
        >
          <SectionHeading title="Current health" />
          <p>
            {!journeys.length
              ? "No saved checks. Current health is not established."
              : !runs.length
                ? "Not tested. No recorded result establishes this site's health."
                : problems.length
                  ? `${problems.length} saved check${problems.length === 1 ? "" : "s"} need attention.`
                  : untested
                    ? `${untested} saved check${untested === 1 ? "" : "s"} have no result.`
                    : current.some((r) => r.status !== "passed")
                      ? "Checks are pending or incomplete. Health is not yet established."
                      : "Latest recorded checks passed. This describes tested behavior, not the entire website."}
          </p>
          {problems.map((r) => (
            <Link key={r.id} href={`/app/runs/${r.id}`} className="problem-row">
              <div>
                <strong>{r.journeyName}</strong>
                <p className="muted">{explain(r).summary}</p>
              </div>
              <StatusIndicator status={r.status} />
              <ArrowRight size={16} />
            </Link>
          ))}
        </section>
      )}
      {!journeysOnly && (
        <section className="latest-run-section">
          <SectionHeading
            title="Latest run"
            action={
              latest && (
                <span className="muted mono small-text">#{latest.number}</span>
              )
            }
          />
          {latest ? (
            <div className="latest-run-surface">
              <div className="latest-run-top">
                <div>
                  <StatusIndicator status={latest.status} large />
                  <h2>{latest.journeyName}</h2>
                  <p>
                    {latest.status === "failed"
                      ? explain(latest).summary
                      : latest.status === "passed"
                        ? "The success condition matched in this recorded run."
                        : isLive
                          ? latest.error ||
                            "Review the current execution state and recorded evidence."
                          : "This is a sample record; no execution is in progress."}
                  </p>
                </div>
                <Link
                  href={`/app/runs/${latest.id}`}
                  className="button secondary"
                >
                  {latest.status === "failed" ? "View evidence" : "View run"}
                  <ArrowRight size={15} />
                </Link>
              </div>
              <dl className="run-quick-meta">
                <div>
                  <dt>Started</dt>
                  <dd className="mono">{relativeTime(latest.startedAt)}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd className="mono">{duration(latest.duration)}</dd>
                </div>
                <div>
                  <dt>Commit</dt>
                  <dd className="mono">{latest.commit}</dd>
                </div>
                <div>
                  <dt>Environment</dt>
                  <dd>{latest.environment}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="quiet-state">
              <ListChecks size={19} />
              <span>
                No runs yet. Define structured journeys and configure GitHub
                Actions to execute them.
              </span>
            </div>
          )}
        </section>
      )}
      {!journeysOnly && (
        <section className="section">
          <SectionHeading
            title="Recent executions"
            count={runs.length}
            action={
              runs.length > 0 && (
                <TextLink href="/app/runs">All workspace runs</TextLink>
              )
            }
          />
          {runs.length ? (
            <RunList runs={runs} projects={[project]} compact />
          ) : (
            <div className="quiet-state">
              <ListChecks size={20} />
              <p>
                No recorded runs. Configure a journey and run tests to create
                one.
              </p>
            </div>
          )}
        </section>
      )}
      <section className="section">
        <SectionHeading
          title={journeysOnly ? "Journeys" : "Saved checks"}
          count={journeys.length}
          action={
            !journeysOnly &&
            journeys.length > 0 && (
              <button className="text-link" onClick={() => setEditor(true)}>
                <Plus size={14} />
                Create journey
              </button>
            )
          }
          description={
            journeysOnly
              ? "Journey definitions. Editing keeps previous run history."
              : undefined
          }
        />
        <JourneysList project={project} journeys={journeys} runs={runs} />
      </section>
      {journeysOnly && (
        <div className="workspace-note">
          <ListChecks size={17} />
          <p>
            {isLive
              ? "Journey definitions are saved to your workspace."
              : "Journey definitions are saved locally."}{" "}
            <span>
              {isLive
                ? "Execution uses your repository’s GitHub Actions runner."
                : "Recording, AI generation, and test execution aren’t available yet."}
            </span>
          </p>
        </div>
      )}
      {execution && (
        <ExecutionLauncher
          project={project}
          onClose={() => setExecution(false)}
        />
      )}
      {editor && (
        <JourneyEditor project={project} onClose={() => setEditor(false)} />
      )}
      {settings && (
        <ProjectSettings project={project} onClose={() => setSettings(false)} />
      )}
    </>
  );
}
