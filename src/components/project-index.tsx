"use client";
import Link from "./workspace-link";
import { useState } from "react";
import { FolderOpen, Plus, Search, SearchX, X } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-store";
import { EmptyState, PageHeader, WorkspaceLoading } from "./ui";
import { ProjectList } from "./rows";
export function ProjectIndex() {
  const { workspace: w } = useWorkspace();
  const [query, setQuery] = useState("");
  if (!w) return <WorkspaceLoading />;
  const projects = w.projects.filter((p) =>
    `${p.name} ${p.url} ${p.repository}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Projects"
        description="The websites and workflows you’re keeping an eye on."
        action={
          <Link href="/app/projects/new" className="button primary">
            <Plus size={16} />
            New project
          </Link>
        }
      />
      {w.projects.length ? (
        <>
          <div className="list-toolbar">
            <div className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search projects"
                placeholder="Search projects…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="icon-button"
                  aria-label="Clear project search"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <span className="result-count" role="status">
              {projects.length} {projects.length === 1 ? "project" : "projects"}
            </span>
          </div>
          {projects.length ? (
            <ProjectList
              projects={projects}
              journeys={w.journeys}
              runs={w.runs}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="No projects found"
              description={`No project matches “${query}”. Try a different name or URL.`}
              action={
                <button
                  className="button secondary"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </button>
              }
            />
          )}
        </>
      ) : (
        <EmptyState
          icon={FolderOpen}
          title="A place for your projects"
          description="Add your first website to organize its test journeys and future results. No GitHub connection is required."
          action={
            <Link className="button primary" href="/app/projects/new">
              <Plus size={16} />
              Create a project
            </Link>
          }
        />
      )}
    </>
  );
}
