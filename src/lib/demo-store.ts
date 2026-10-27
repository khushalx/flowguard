"use client";

import { useSyncExternalStore } from "react";
import { initialStorage } from "./demo";
import {
  storageSchema,
  type Storage,
  type Workspace,
  type Project,
  type Journey,
} from "./model";

const KEY = "flowguard.workspace.v1";
type Snapshot = { data: Storage | null; error: string | null };
const serverSnapshot: Snapshot = { data: null, error: null };
let snapshot = serverSnapshot;
let initialized = false;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => fn());
}
function load() {
  try {
    const saved = localStorage.getItem(KEY);
    snapshot = {
      data: saved ? storageSchema.parse(JSON.parse(saved)) : initialStorage(),
      error: null,
    };
  } catch {
    snapshot = {
      data: null,
      error:
        "Your workspace could not be read. Browser storage may be unavailable, or the saved data may be damaged.",
    };
  }
  emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    queueMicrotask(load);
  }
  const sync = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) load();
  };
  window.addEventListener("storage", sync);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", sync);
  };
}
function save(next: Storage) {
  // Persist before publishing so a failed write never looks like a successful edit.
  try {
    localStorage.setItem(KEY, JSON.stringify(storageSchema.parse(next)));
    snapshot = { data: next, error: null };
    emit();
    return true;
  } catch {
    throw new Error(
      "Changes could not be saved. Check that browser storage is available and has space, then try again.",
    );
  }
}
function mutate(update: (workspace: Workspace) => Workspace) {
  if (!snapshot.data) throw new Error("The workspace is not ready yet.");
  const data = snapshot.data;
  return save({ ...data, [data.mode]: update(data[data.mode]) });
}

export const workspaceActions = {
  setMode(mode: Storage["mode"]) {
    if (!snapshot.data) throw new Error("The workspace is not ready yet.");
    return save({ ...snapshot.data, mode });
  },
  recover() {
    return save(initialStorage());
  },
  createProject(input: Omit<Project, "id" | "createdAt">) {
    const project = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    mutate((w) => ({ ...w, projects: [...w.projects, project] }));
    return project;
  },
  updateProject(project: Project) {
    return mutate((w) => ({
      ...w,
      projects: w.projects.map((p) => (p.id === project.id ? project : p)),
    }));
  },
  deleteProject(id: string) {
    return mutate((w) => ({
      projects: w.projects.filter((p) => p.id !== id),
      journeys: w.journeys.filter((j) => j.projectId !== id),
      runs: w.runs.filter((r) => r.projectId !== id),
    }));
  },
  saveJourney(input: Omit<Journey, "id" | "createdAt">, existing?: Journey) {
    const journey = {
      ...input,
      id: existing?.id ?? crypto.randomUUID(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    mutate((w) => ({
      ...w,
      journeys: existing
        ? w.journeys.map((j) => (j.id === journey.id ? journey : j))
        : [...w.journeys, journey],
    }));
    return journey;
  },
  deleteJourney(id: string) {
    return mutate((w) => ({
      ...w,
      journeys: w.journeys.filter((j) => j.id !== id),
    }));
  },
};

export function useWorkspace() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
  return {
    ...state,
    workspace: state.data ? state.data[state.data.mode] : null,
    actions: workspaceActions,
  };
}
