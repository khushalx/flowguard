"use client";
import { useState } from "react";
import { storageSchema, type Workspace } from "@/lib/model";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import { Dialog } from "./ui";
import { useFeedback } from "./feedback";

export function LocalImport() {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useWorkspace();
  const notify = useFeedback();
  function inspect() {
    setOpen(true);
    setError(null);
    try {
      const saved = localStorage.getItem("flowguard.workspace.v1");
      setLocal(
        saved
          ? storageSchema.parse(JSON.parse(saved)).local
          : { projects: [], journeys: [], runs: [] },
      );
    } catch {
      setLocal(null);
      setError(
        "Local data could not be read or validated. No data has been imported.",
      );
    }
  }
  return (
    <>
      <button className="button secondary" onClick={inspect}>
        Import local projects
      </button>
      {open && (
        <Dialog
          title="Import local projects"
          description="Import only projects and journeys from your previous Local workspace in this browser. Demo projects, sample runs, and repository text references are excluded. Local data is kept."
          onClose={() => setOpen(false)}
        >
          {local && (
            <>
              <p>
                {local.projects.length} projects · {local.journeys.length}{" "}
                journeys
              </p>
              {local.projects.length > 0 && (
                <ul className="import-list">
                  {local.projects.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong>
                      <span className="mono">{p.url}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="field-hint">
                Existing matching projects and journeys are kept. The import is
                validated and saved as one transaction.
              </p>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !local?.projects.length}
              onClick={async () => {
                if (!local) return;
                setBusy(true);
                setError(null);
                try {
                  await apiRequest("/api/workspace", {
                    action: "importLocal",
                    projects: local.projects,
                    journeys: local.journeys,
                  });
                  await refresh();
                  notify(
                    "Local projects imported. No test results were imported.",
                  );
                  setOpen(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Import failed.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Importing…" : "Import projects"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
