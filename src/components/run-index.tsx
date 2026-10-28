"use client";
import { useState } from "react";
import { ListChecks, Search, SearchX, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-store";
import type { RunStatus } from "@/lib/model";
import { EmptyState, PageHeader, WorkspaceLoading } from "./ui";
import { RunList } from "./rows";
export function RunIndex() {
  const { workspace: w, data, runsHasMore, loadMoreRuns } = useWorkspace();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RunStatus | "all">("all");
  if (!w) return <WorkspaceLoading />;
  const runs = w.runs
    .filter(
      (r) =>
        (status === "all" || r.status === status) &&
        `${r.journeyName} ${r.commit} ${r.number} ${w.projects.find((p) => p.id === r.projectId)?.name}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return (
    <>
      <PageHeader
        title="Runs"
        description={
          data?.mode === "demo"
            ? "Recorded sample results, with every step and its evidence."
            : "Execution history across your projects."
        }
      />
      {w.runs.length ? (
        <>
          <div className="runs-toolbar">
            <div
              className="filter-tabs"
              role="group"
              aria-label="Filter by result"
            >
              {(["all", "failed", "passed", "running", "unknown"] as const).map(
                (s) => (
                  <button
                    key={s}
                    aria-pressed={status === s}
                    onClick={() => setStatus(s)}
                  >
                    {s === "all"
                      ? "All runs"
                      : s === "unknown"
                        ? "No result"
                        : s.charAt(0).toUpperCase() + s.slice(1)}
                    {s === "all" && (
                      <span className="count">{w.runs.length}</span>
                    )}
                  </button>
                ),
              )}
            </div>
            <div className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search runs"
                placeholder="Search runs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear run search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <p className="sr-only" role="status">
            {runs.length} runs found
          </p>
          {runs.length ? (
            <RunList runs={runs} projects={w.projects} />
          ) : (
            <EmptyState
              icon={SearchX}
              title="No matching runs"
              description="Try another search or show all results."
              action={
                <button
                  className="button secondary"
                  onClick={() => {
                    setQuery("");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </button>
              }
            />
          )}
        </>
      ) : (
        <EmptyState
          icon={ListChecks}
          title="Your run history will appear here"
          description="Configure a project and its journeys first. This frontend does not execute tests yet, so no results have been created."
        />
      )}
      {runsHasMore && (
        <div className="load-more-runs">
          <p className="field-hint">
            Showing loaded runs. Load earlier runs to include them in search and
            filters.
          </p>
          <button
            className="button secondary"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              setLoadError(null);
              try {
                await loadMoreRuns();
              } catch (e) {
                setLoadError(
                  e instanceof Error
                    ? e.message
                    : "Earlier runs could not be loaded.",
                );
              } finally {
                setLoadingMore(false);
              }
            }}
          >
            {loadingMore ? "Loading…" : "Load earlier runs"}
          </button>
          {loadError && (
            <p className="form-error" role="alert">
              {loadError}
            </p>
          )}
        </div>
      )}
    </>
  );
}
