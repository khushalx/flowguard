"use client";
import Link from "./workspace-link";
import { useState, type FormEvent } from "react";
import { ArrowUpRight, Pencil, Plus, Route, Trash2, Play } from "lucide-react";
import {
  latestRun,
  validPath,
  type Journey,
  type Project,
  type Run,
} from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import { errorMessage, useFeedback } from "./feedback";
import { ConfirmDialog, Dialog, EmptyState, StatusIndicator } from "./ui";
import { StructuredJourneyEditor } from "./structured-journey-editor";
import { ExecutionLauncher } from "./execution-dialog";

export function JourneyEditor({
  project,
  journey,
  onClose,
}: {
  project: Project;
  journey?: Journey;
  onClose: () => void;
}) {
  const { isLive } = useWorkspace();
  return isLive ? (
    <StructuredJourneyEditor
      project={project}
      journey={journey}
      onClose={onClose}
    />
  ) : (
    <LegacyJourneyEditor
      project={project}
      journey={journey}
      onClose={onClose}
    />
  );
}
function LegacyJourneyEditor({
  project,
  journey,
  onClose,
}: {
  project: Project;
  journey?: Journey;
  onClose: () => void;
}) {
  const [name, setName] = useState(journey?.name ?? "");
  const [path, setPath] = useState(journey?.path ?? "/");
  const [condition, setCondition] = useState(journey?.condition ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { actions, isLive } = useWorkspace();
  const notify = useFeedback();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const validation: Record<string, string> = {};
    if (!name.trim()) validation.name = "Give this journey a name.";
    if (!validPath(path.trim()))
      validation.path = "Use a path starting with / or a complete http(s) URL.";
    if (!condition.trim())
      validation.condition =
        "Describe what a successful result should look like.";
    setErrors(validation);
    if (Object.keys(validation).length) {
      document.getElementById(`journey-${Object.keys(validation)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      await actions.saveJourney(
        {
          projectId: project.id,
          name: name.trim(),
          path: path.trim(),
          condition: condition.trim(),
        },
        journey,
      );
      notify(
        journey
          ? isLive
            ? "Journey updated."
            : "Journey updated locally."
          : isLive
            ? "Journey created. It has not been executed."
            : "Journey created locally. It has not been executed.",
      );
      onClose();
    } catch (error) {
      setSaveError(errorMessage(error));
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={journey ? "Edit journey" : "Create a journey"}
      description="Define a workflow and the outcome you expect. This saves a definition; it does not record or generate a test."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="journey-name">Journey name</label>
          <input
            id="journey-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Complete a checkout"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "journey-name-error" : undefined}
          />
          {errors.name && (
            <p className="field-error" id="journey-name-error">
              {errors.name}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="journey-path">Start path or URL</label>
          <input
            id="journey-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            maxLength={500}
            placeholder="/checkout"
            aria-invalid={!!errors.path}
            aria-describedby={
              errors.path ? "journey-path-error" : "journey-path-hint"
            }
          />
          {errors.path ? (
            <p className="field-error" id="journey-path-error">
              {errors.path}
            </p>
          ) : (
            <p className="field-hint mono" id="journey-path-hint">
              Relative to {project.url}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="journey-condition">Success condition</label>
          <textarea
            id="journey-condition"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="e.g. The order confirmation is visible after checkout."
            aria-invalid={!!errors.condition}
            aria-describedby={
              errors.condition ? "journey-condition-error" : undefined
            }
          />
          {errors.condition && (
            <p className="field-error" id="journey-condition-error">
              {errors.condition}
            </p>
          )}
        </div>
        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            {saving ? "Saving…" : journey ? "Save changes" : "Create journey"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function JourneyRow({
  journey,
  run,
  onEdit,
  onDelete,
  onRun,
}: {
  journey: Journey;
  run?: Run;
  onEdit: () => void;
  onDelete: () => void;
  onRun?: () => void;
}) {
  const { isLive } = useWorkspace();
  return (
    <li className="journey-row">
      <Route
        className="journey-icon"
        size={18}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="journey-identity">
        <h3>{journey.name}</h3>
        <p className="mono journey-path">{journey.path}</p>
        <p className="journey-condition">{journey.condition}</p>
        {journey.enabled === false ? (
          <span className="neutral-tag">Disabled</span>
        ) : (
          isLive &&
          !journey.definition && (
            <span className="neutral-tag">Needs configuration</span>
          )
        )}
      </div>
      <div className="journey-result">
        {run ? (
          <Link
            className="journey-result-link"
            href={`/app/runs/${run.id}`}
            aria-label={`${journey.name}: ${run.status}. View last run`}
          >
            <StatusIndicator status={run.status} />
            <ArrowUpRight size={13} />
          </Link>
        ) : (
          <StatusIndicator status="unknown" label="Not run" />
        )}
      </div>
      <div className="row-actions">
        {onRun && (
          <button
            className="icon-button"
            onClick={onRun}
            aria-label={`Run ${journey.name}`}
            title="Run this journey"
          >
            <Play size={15} />
          </button>
        )}
        <button
          className="icon-button"
          onClick={onEdit}
          aria-label={`Edit ${journey.name}`}
          title="Edit journey"
        >
          <Pencil size={15} />
        </button>
        <button
          className="icon-button"
          onClick={onDelete}
          aria-label={`Delete ${journey.name}`}
          title="Delete journey"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </li>
  );
}

export function JourneysList({
  project,
  journeys,
  runs,
}: {
  project: Project;
  journeys: Journey[];
  runs: Run[];
}) {
  const [editor, setEditor] = useState<Journey | "new" | null>(null);
  const [deleting, setDeleting] = useState<Journey | null>(null);
  const [executing, setExecuting] = useState<Journey | null>(null);
  const { actions, isLive } = useWorkspace();
  const notify = useFeedback();
  return (
    <>
      {journeys.length ? (
        <ul className="journey-list">
          {journeys.map((j) => (
            <JourneyRow
              key={j.id}
              journey={j}
              run={latestRun(runs, project.id, j.id)}
              onEdit={() => setEditor(j)}
              onDelete={() => setDeleting(j)}
              onRun={isLive ? () => setExecuting(j) : undefined}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Route}
          title="Define your first journey"
          description="Start with a workflow your users rely on: signing in, submitting a form, or finishing a checkout."
          action={
            <button
              className="button secondary"
              onClick={() => setEditor("new")}
            >
              <Plus size={15} />
              Create journey
            </button>
          }
        />
      )}
      {editor && (
        <JourneyEditor
          key={editor === "new" ? "new" : editor.id}
          project={project}
          journey={editor === "new" ? undefined : editor}
          onClose={() => setEditor(null)}
        />
      )}
      {executing && (
        <ExecutionLauncher
          project={project}
          journeyId={executing.id}
          onClose={() => setExecuting(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this journey?"
          description={`“${deleting.name}” will be removed from this project. Its recorded run history will be kept.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              await actions.deleteJourney(deleting.id);
              setDeleting(null);
              notify("Journey deleted. Recorded runs were kept.");
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      )}
    </>
  );
}
