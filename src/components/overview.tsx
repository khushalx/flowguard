"use client";
import Link from "./workspace-link";
import { ArrowUpRight, Check, Plus, Route } from "lucide-react";
import { latestRun, relativeTime } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import {
  EmptyState,
  PageHeader,
  SectionHeading,
  TextLink,
  WorkspaceLoading,
  StatusIndicator,
} from "./ui";
import { ProjectAvatar, ProjectList, RunList } from "./rows";

export function Overview() {
  const { workspace: w, isLive } = useWorkspace();
  if (!w) return <WorkspaceLoading />;
  const failures = w.journeys
    .map((j) => latestRun(w.runs, j.projectId, j.id))
    .filter((r) => r && ["failed", "error", "timed_out"].includes(r.status));
  const recent = [...w.runs].sort(
    (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
  );
  return (
    <>
      <PageHeader
        title="Overview"
        description="Your projects. Their journeys. What needs a closer look."
        action={
          <Link href="/app/projects/new" className="button primary">
            <Plus size={17} />
            New project
          </Link>
        }
      />
      {!w.projects.length ? (
        <div className="workspace-empty">
          <EmptyState
            icon={Route}
            title="Your first project starts here"
            description={
              isLive
                ? "Welcome to your workspace. Add a website and define a journey your users depend on. Your configuration is saved to your account."
                : "Add a website and define a journey your users depend on. Your project configuration will be saved in this browser."
            }
            action={
              <Link className="button primary" href="/app/projects/new">
                <Plus size={16} />
                Create a project
              </Link>
            }
          />
          <div className="empty-explainer">
            <span>
              <span className="mono">01</span>Add your website
            </span>
            <span>
              <span className="mono">02</span>Define a journey
            </span>
            <span>
              <span className="mono">03</span>Configure execution
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="overview-top">
            <section
              className="attention-section"
              aria-label="Journeys needing attention"
            >
              <SectionHeading title="Needs attention" count={failures.length} />
              {failures.length ? (
                failures.map((run) => {
                  if (!run) return null;
                  const project = w.projects.find(
                    (p) => p.id === run.projectId,
                  );
                  if (!project) return null;
                  return (
                    <Link
                      className="attention-item"
                      key={run.id}
                      href={`/app/runs/${run.id}`}
                    >
                      <div className="attention-meta">
                        <ProjectAvatar project={project} small />
                        <span>{project.name}</span>
                        <span className="inline-dot">/</span>
                        <span className="mono">#{run.number}</span>
                        <StatusIndicator status={run.status} />
                      </div>
                      <h3>{run.journeyName}</h3>
                      <p>
                        {run.error ||
                          (run.assertion
                            ? `Expected “${run.assertion.expected}”. Inspect the observed result.`
                            : "Inspect the recorded steps and execution evidence.")}
                      </p>
                      <div className="attention-bottom">
                        <span className="mono">
                          {relativeTime(run.startedAt)}
                          <span className="inline-dot">·</span>
                          {run.commit}
                        </span>
                        <span className="evidence-link">
                          View evidence <ArrowUpRight size={16} />
                        </span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="quiet-state">
                  <Check size={20} />
                  <div>
                    <h3>Nothing needs your attention</h3>
                    <p>
                      {w.runs.length
                        ? "No failures in the latest recorded journey results."
                        : "No results yet. Configure a journey and GitHub Actions to run tests."}
                    </p>
                  </div>
                </div>
              )}
            </section>
            <aside className="workspace-summary" aria-label="Workspace summary">
              <SectionHeading title="Workspace" />
              <dl className="summary-strip">
                {[
                  [w.projects.length, "Projects"],
                  [w.journeys.length, "Journey definitions"],
                  [w.runs.length, "Recorded runs"],
                  [failures.length, "Failing journeys"],
                ].map(([count, label]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{String(count).padStart(2, "0")}</dd>
                  </div>
                ))}
              </dl>
            </aside>
          </div>
          <div className="overview-columns">
            <section className="section">
              <SectionHeading
                title="Projects"
                count={w.projects.length}
                action={<TextLink href="/app/projects">All projects</TextLink>}
              />
              <ProjectList
                projects={w.projects}
                journeys={w.journeys}
                runs={w.runs}
              />
            </section>
            <section className="section recent-section">
              <SectionHeading
                title="Recent runs"
                action={<TextLink href="/app/runs">All runs</TextLink>}
              />
              {recent.length ? (
                <RunList
                  runs={recent.slice(0, 4)}
                  projects={w.projects}
                  compact
                />
              ) : (
                <div className="quiet-state">
                  <Route size={20} />
                  <p>
                    No recorded runs. Configure a journey and run tests from its
                    project.
                  </p>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
