"use client";
import type { ReactNode } from "react";
import { useWorkspace as useDemoWorkspace } from "./demo-store";
import { Context, type State } from "./workspace-context";
type Actions = State["actions"];
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
        setConnections: () => {},
        discoverRepositories: async () => {},
        loadRun: async () => {},
        loadMoreRuns: async () => {},
        runsHasMore: false,
      }}
    >
      {children}
    </Context.Provider>
  );
}
