"use client";
import { useState, type FormEvent } from "react";
import { useWorkspaceRouter as useRouter } from "./workspace-link";
import { Trash2 } from "lucide-react";
import { validTarget, type Project } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import { errorMessage, useFeedback } from "./feedback";
import { RepositoryPicker } from "./repository-picker";
import { ConfirmDialog, Dialog } from "./ui";
export function ProjectSettings({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [url, setUrl] = useState(project.url);
  const [repository, setRepository] = useState(project.repository);
  const [repositoryId, setRepositoryId] = useState(
    project.repositoryId ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const { actions, isLive } = useWorkspace();
  const notify = useFeedback();
  const router = useRouter();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Enter a project name.";
    if (!validTarget(url.trim()))
      next.url = "Enter a complete http:// or https:// URL.";
    if (
      !isLive &&
      repository.trim() &&
      !/^[\w.-]+\/[\w.-]+$/.test(repository.trim())
    )
      next.repository = "Use owner/repository, or leave this empty.";
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`edit-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await actions.updateProject({
        ...project,
        name: name.trim(),
        url: url.trim(),
        repository: repository.trim(),
        repositoryId,
      });
      notify(
        isLive ? "Project settings saved." : "Project settings saved locally.",
      );
      onClose();
    } catch (e) {
      setSaveError(errorMessage(e));
      setSaving(false);
    }
  }
  if (deleting)
    return (
      <ConfirmDialog
        title={`Delete ${project.name}?`}
        description="This will remove the project, all its journeys, and its recorded runs from this workspace. This cannot be undone."
        confirmLabel="Delete project"
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await actions.deleteProject(project.id);
            notify("Project deleted from this workspace.");
            onClose();
            router.push("/app/projects");
          } catch (e) {
            return errorMessage(e);
          }
        }}
      />
    );
  return (
    <Dialog
      title="Project settings"
      description={
        isLive
          ? "Changes are saved to your account."
          : "Changes are saved only in this browser workspace."
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} noValidate>
        {(
          [
            ["name", "Project name", name, setName, 80],
            ["url", "Target URL", url, setUrl, 2000],
            [
              "repository",
              "Repository (optional)",
              repository,
              setRepository,
              160,
            ],
          ] as const
        )
          .filter(([key]) => !isLive || key !== "repository")
          .map(([key, label, value, setter, max]) => (
            <div className="field" key={key}>
              <label htmlFor={`edit-${key}`}>{label}</label>
              <input
                id={`edit-${key}`}
                type={key === "url" ? "url" : "text"}
                value={value}
                maxLength={max}
                onChange={(e) => setter(e.target.value)}
                aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? `edit-${key}-error` : undefined}
              />
              {errors[key] && (
                <p className="field-error" id={`edit-${key}-error`}>
                  {errors[key]}
                </p>
              )}
            </div>
          ))}
        {isLive ? (
          <RepositoryPicker
            returnTo={`/app/projects/${project.id}?settings=repository`}
            value={repositoryId}
            onChange={(id, name) => {
              setRepositoryId(id);
              setRepository(name);
            }}
          />
        ) : (
          <p className="field-hint">
            Repository is a text reference. GitHub is not connected.
          </p>
        )}
        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button ghost delete-project"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={15} />
            Delete project
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
