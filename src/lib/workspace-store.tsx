"use client";
import { useState, useCallback, useRef, type ReactNode } from "react";
import { Context, apiRequest, type State } from "./workspace-context";
import { projectSchema, journeySchema, runSchema } from "./model";
import type { LiveSnapshot } from "./server/workspace";
export {
  apiRequest,
  useWorkspace,
  useWorkspaceBase,
} from "./workspace-context";
export function LiveWorkspaceProvider({
  initial,
  githubAvailable,
  children,
}: {
  initial: LiveSnapshot;
  githubAvailable: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState(initial);
  const runDetails = useRef(new Map<string, Promise<void>>());
  const loadRun = useCallback(async (id: string) => {
    if (runDetails.current.has(id)) return runDetails.current.get(id);
    const pending = apiRequest(`/api/runs/${encodeURIComponent(id)}`)
      .then((result) => {
        const run = runSchema.parse(result);
        setState((s) => ({
          ...s,
          workspace: {
            ...s.workspace,
            runs: [...s.workspace.runs.filter((r) => r.id !== id), run],
          },
        }));
      })
      .catch((error) => {
        runDetails.current.delete(id);
        throw error;
      });
    runDetails.current.set(id, pending);
    return pending;
  }, []);
  const runOffset = useRef(initial.runOffset);
  async function loadMoreRuns() {
    const result = await apiRequest(`/api/runs?offset=${runOffset.current}`);
    const runs = runSchema.array().parse(result.runs);
    runOffset.current += runs.length;
    setState((s) => ({
      ...s,
      runsHasMore: result.hasMore,
      workspace: {
        ...s.workspace,
        runs: [
          ...s.workspace.runs,
          ...runs.filter(
            (r) => !s.workspace.runs.some((old) => old.id === r.id),
          ),
        ],
      },
    }));
  }
  const discovery = useRef<{ pending: Promise<void> | null; checked: number }>({
    pending: null,
    checked: 0,
  });
  const discoverRepositories = useCallback(
    async (force = false) => {
      if (!githubAvailable) return;
      if (discovery.current.pending) return discovery.current.pending;
      if (!force && Date.now() - discovery.current.checked < 60_000) return;
      const pending = apiRequest("/api/github", {
        action: "discover",
        refresh: force,
      })
        .then((result) => {
          setState((s) => ({
            ...s,
            repositories: result.repositories,
            installations: result.installations,
          }));
          discovery.current.checked = Date.now();
        })
        .catch(async (error) => {
          // A failed verification may have reconciled a removal in SQL.
          // Replace stale connection labels without reloading the workspace.
          try {
            const connections = await apiRequest("/api/github");
            setState((s) => ({
              ...s,
              repositories: connections.repositories,
              installations: connections.installations,
            }));
          } catch {
            throw new Error(
              `${error instanceof Error ? error.message : "Repository access could not be checked."} Reload to check the latest connection state.`,
            );
          }
          throw error;
        })
        .finally(() => {
          discovery.current.pending = null;
        });
      discovery.current.pending = pending;
      return pending;
    },
    [githubAvailable],
  );
  const refresh = useCallback(async () => {
    const next = await apiRequest("/api/workspace");
    runOffset.current = next.runOffset;
    runDetails.current.clear();
    setState(next);
  }, []);
  function setConnections(
    connections: Pick<LiveSnapshot, "repositories" | "installations">,
  ) {
    setState((s) => ({
      ...s,
      repositories: connections.repositories,
      installations: connections.installations,
    }));
  }
  const actions: State["actions"] = {
    async createProject(input) {
      const result = await apiRequest("/api/workspace", {
        action: "createProject",
        input,
      });
      const project = projectSchema.parse(result.project);
      setState((s) => ({
        ...s,
        workspace: {
          ...s.workspace,
          projects: [...s.workspace.projects, project],
        },
      }));
      return project;
    },
    async updateProject(input) {
      const result = await apiRequest("/api/workspace", {
        action: "updateProject",
        id: input.id,
        input,
      });
      const project = projectSchema.parse(result.project);
      setState((s) => ({
        ...s,
        workspace: {
          ...s.workspace,
          projects: s.workspace.projects.map((p) =>
            p.id === project.id ? project : p,
          ),
        },
      }));
    },
    async deleteProject(id) {
      await apiRequest("/api/workspace", { action: "deleteProject", id });
      setState((s) => ({
        ...s,
        workspace: {
          projects: s.workspace.projects.filter((p) => p.id !== id),
          journeys: s.workspace.journeys.filter((j) => j.projectId !== id),
          runs: s.workspace.runs.filter((r) => r.projectId !== id),
        },
      }));
    },
    async saveJourney(input, existing) {
      const result = await apiRequest("/api/workspace", {
        action: "saveJourney",
        input,
        id: existing?.id,
      });
      const journey = journeySchema.parse(result.journey);
      setState((s) => ({
        ...s,
        workspace: {
          ...s.workspace,
          journeys: existing
            ? s.workspace.journeys.map((j) =>
                j.id === journey.id ? journey : j,
              )
            : [...s.workspace.journeys, journey],
        },
      }));
      return journey;
    },
    async deleteJourney(id) {
      await apiRequest("/api/workspace", { action: "deleteJourney", id });
      setState((s) => ({
        ...s,
        workspace: {
          ...s.workspace,
          journeys: s.workspace.journeys.filter((j) => j.id !== id),
          runs: s.workspace.runs.map((r) =>
            r.journeyId === id ? { ...r, journeyId: "" } : r,
          ),
        },
      }));
    },
    setMode: async () => {
      throw new Error("Open the separate demo to use browser-only data.");
    },
    recover: async () => refresh(),
  };
  return (
    <Context.Provider
      value={{
        data: { mode: "live" },
        workspace: state.workspace,
        error: null,
        actions,
        info: state.info,
        repositories: state.repositories,
        installations: state.installations,
        isLive: true,
        basePath: "/app",
        githubAvailable,
        setConnections,
        discoverRepositories,
        loadRun,
        loadMoreRuns,
        runsHasMore: state.runsHasMore,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
