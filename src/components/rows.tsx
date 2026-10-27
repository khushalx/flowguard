"use client";
import Link from "./workspace-link";
import { ArrowUpRight, GitCommitHorizontal } from "lucide-react";
import {
  duration,
  host,
  latestRun,
  relativeTime,
  type Journey,
  type Project,
  type Run,
} from "@/lib/model";
import { StatusIndicator } from "./ui";

export function ProjectAvatar({
  project,
  small = false,
}: {
  project: Project;
  small?: boolean;
}) {
  return (
    <span
      className={`project-avatar project-avatar-${project.id === "ledger" ? "ledger" : project.id === "formkit" ? "formkit" : "default"} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {project.id === "ledger" ? (
        <span className="ledger-glyph">
          <i />
          <i />
          <i />
        </span>
      ) : project.id === "formkit" ? (
        <span className="formkit-glyph">f</span>
      ) : (
        project.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
export function ProjectRow({
  project,
  journeys,
  runs,
}: {
  project: Project;
  journeys: Journey[];
  runs: Run[];
}) {
  const run = latestRun(runs, project.id);
  const definitions = journeys.filter((j) => j.projectId === project.id);
  const failing = definitions.filter(
    (j) => latestRun(runs, project.id, j.id)?.status === "failed",
  ).length;
  return (
    <li>
      <Link href={`/app/projects/${project.id}`} className="project-row">
        <div className="project-identity">
          <ProjectAvatar project={project} />
          <div>
            <span className="row-title">{project.name}</span>
            <span className="row-subtitle mono">{host(project.url)}</span>
          </div>
        </div>
        <div className="project-facts">
          <span className="journey-count">
            {definitions.length}{" "}
            {definitions.length === 1 ? "journey" : "journeys"}
          </span>
          <StatusIndicator
            status={failing ? "failed" : run?.status}
            label={
              failing
                ? `${failing} failing ${failing === 1 ? "journey" : "journeys"}`
                : run?.status === "passed"
                  ? "Latest run passed"
                  : undefined
            }
          />
          <time
            className="row-time mono"
            dateTime={run?.startedAt}
            title={run ? new Date(run.startedAt).toLocaleString() : undefined}
          >
            {run ? relativeTime(run.startedAt) : "Never run"}
          </time>
        </div>
        <ArrowUpRight className="row-chevron" size={17} aria-hidden="true" />
      </Link>
    </li>
  );
}
export function ProjectList({
  projects,
  journeys,
  runs,
}: {
  projects: Project[];
  journeys: Journey[];
  runs: Run[];
}) {
  return (
    <div className="project-list">
      <ul>
        {projects.map((p) => (
          <ProjectRow key={p.id} project={p} journeys={journeys} runs={runs} />
        ))}
      </ul>
    </div>
  );
}
export function RunRow({
  run,
  project,
  compact = false,
}: {
  run: Run;
  project?: Project;
  compact?: boolean;
}) {
  return (
    <li>
      <Link
        href={`/app/runs/${run.id}`}
        className={`run-row ${compact ? "compact" : ""}`}
      >
        <span className="run-outcome">
          <StatusIndicator status={run.status} />
        </span>
        <div className="run-identity">
          <span className="row-title">{run.journeyName}</span>
          <span className="row-subtitle">
            <span>{project?.name ?? "Project"}</span>
            <span className="inline-dot">/</span>
            <span className="run-number mono">#{run.number}</span>
          </span>
        </div>
        <div className="run-context">
          <span className="run-commit mono">
            <GitCommitHorizontal size={15} aria-hidden="true" />
            {run.commit}
          </span>
          <time
            className="row-time mono"
            dateTime={run.startedAt}
            title={new Date(run.startedAt).toLocaleString()}
          >
            {relativeTime(run.startedAt)}
          </time>
          <span className="run-duration mono">{duration(run.duration)}</span>
        </div>
        <ArrowUpRight className="row-chevron" size={16} aria-hidden="true" />
      </Link>
    </li>
  );
}
export function RunList({
  runs,
  projects,
  compact = false,
}: {
  runs: Run[];
  projects: Project[];
  compact?: boolean;
}) {
  return (
    <div className={`run-list ${compact ? "compact" : ""}`}>
      <ul>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            project={projects.find((p) => p.id === run.projectId)}
            compact={compact}
          />
        ))}
      </ul>
    </div>
  );
}
