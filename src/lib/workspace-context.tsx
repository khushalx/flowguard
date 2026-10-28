"use client";
import { createContext, useContext } from "react";
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
export type State = {
  data: { mode: Storage["mode"] | "live" } | null;
  workspace: Workspace | null;
  error: string | null;
  actions: Actions;
  info: WorkspaceInfo | null;
  repositories: Repository[];
  installations: Installation[];
  githubAvailable: boolean;
  setConnections: (
    data: Pick<LiveSnapshot, "repositories" | "installations">,
  ) => void;
  discoverRepositories: (force?: boolean) => Promise<void>;
  loadRun: (id: string) => Promise<void>;
  loadMoreRuns: () => Promise<void>;
  runsHasMore: boolean;
  isLive: boolean;
  basePath: string;
  refresh: () => Promise<void>;
};
export const Context = createContext<State | null>(null);

export async function apiRequest(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(
      "The request could not finish. Check your connection and reload to confirm the saved state before retrying.",
    );
  }
  if (response.status === 401) {
    // A full navigation clears authenticated client state on expiry.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/login?error=session_expired&next=${encodeURIComponent(location.pathname + location.search)}`,
    );
    throw new Error("Your session has expired. Sign in again.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error ??
        "The server could not complete the request. Try again shortly.",
    );
  if (!result)
    throw new Error(
      "The server returned an incomplete response. Reload to check the saved state.",
    );
  return result;
}
export function useWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error("Workspace provider is missing.");
  return state;
}
export function useWorkspaceBase() {
  return useContext(Context)?.basePath ?? "/app";
}
