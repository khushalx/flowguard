"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useWorkspace as useDemoWorkspace } from "./demo-store";
import type { Project, Journey, Workspace, Storage } from "./model";
import type { Repository, Installation, WorkspaceInfo } from "./contracts";
import type { LiveSnapshot } from "./server/workspace";

type Actions = {
  createProject(input: Omit<Project, "id" | "createdAt">): Promise<Project>;
  updateProject(project: Project): Promise<unknown>;
  deleteProject(id: string): Promise<unknown>;
  saveJourney(
    input: Omit<Journey, "id" | "createdAt">,
    existing?: Journey,
  ): Promise<Journey>;
  deleteJourney(id: string): Promise<unknown>;
  setMode(mode: Storage["mode"]): Promise<unknown>;
  recover(): Promise<unknown>;
};
type State = {
  data: { mode: Storage["mode"] | "live" } | null;
  workspace: Workspace | null;
  error: string | null;
  actions: Actions;
  info: WorkspaceInfo | null;
  repositories: Repository[];
  installations: Installation[];
  githubAvailable: boolean;
  isLive: boolean;
  basePath: string;
  refresh: () => Promise<void>;
};
const Context = createContext<State | null>(null);

export async function apiRequest(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json();
  if (response.status === 401) {
    // A full navigation clears all authenticated client state on expiry.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/login?error=session_expired&next=${encodeURIComponent(location.pathname + location.search)}`,
    );
    throw new Error("Your session has expired. Sign in again.");
  }
  if (!response.ok)
    throw new Error(result.error ?? "Request failed. Try again.");
  return result;
}
export function DemoWorkspaceProvider({ children }: { children: ReactNode }) {
  const demo = useDemoWorkspace();
  const local = demo.actions;
  const actions: Actions = {
    createProject: async (p) => local.createProject(p),
    updateProject: async (p) => local.updateProject(p),
    deleteProject: async (id) => local.deleteProject(id),
    saveJourney: async (p, j) => local.saveJourney(p, j),
    deleteJourney: async (id) => local.deleteJourney(id),
    setMode: async (mode) => local.setMode(mode),
    recover: async () => local.recover(),
  };
  return (
    <Context.Provider
      value={{
        ...demo,
        actions,
        info: null,
        repositories: [],
        installations: [],
        githubAvailable: false,
        isLive: false,
        basePath: "/demo",
        refresh: async () => {},
      }}
    >
      {children}
    </Context.Provider>
  );
}
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
  const refresh = useCallback(async () => {
    setState(await apiRequest("/api/workspace"));
  }, []);
  async function mutate(body: unknown) {
    const result = await apiRequest("/api/workspace", body);
    try {
      await refresh();
    } catch {
      throw new Error(
        "Saved to your workspace, but the view could not refresh. Reload before making further changes.",
      );
    }
    return result as { id: string };
  }
  const actions: Actions = {
    async createProject(input) {
      const result = await mutate({ action: "createProject", input });
      return { ...input, id: result.id, createdAt: new Date().toISOString() };
    },
    updateProject: async (input) =>
      mutate({ action: "updateProject", id: input.id, input }),
    deleteProject: async (id) => mutate({ action: "deleteProject", id }),
    async saveJourney(input, existing) {
      const result = await mutate({
        action: "saveJourney",
        input,
        id: existing?.id,
      });
      return {
        ...input,
        id: result.id,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
    },
    deleteJourney: async (id) => mutate({ action: "deleteJourney", id }),
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
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error("Workspace provider is missing.");
  return state;
}
export function useWorkspaceBase() {
  return useContext(Context)?.basePath ?? "/app";
}
