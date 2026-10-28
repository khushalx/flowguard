"use client";
import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Globe, TextSearch } from "lucide-react";
import { pageCheck } from "@/lib/check-presets";
import type { Journey, Project } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";
import { errorMessage } from "./feedback";

export function QuickCheck({
  project,
  onSaved,
  onCustom,
  label = "Continue",
}: {
  project: Project;
  onSaved: (journey: Journey) => void;
  onCustom: () => void;
  label?: string;
}) {
  const { actions } = useWorkspace();
  const [kind, setKind] = useState<"load" | "text">("load");
  const [path, setPath] = useState("/");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    if (kind === "text" && !expected.trim()) {
      setError("Enter text that should appear on the page.");
      document.getElementById("check-text")?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const input = pageCheck(
        project.url,
        path,
        kind === "text" ? expected : "",
      );
      onSaved(await actions.saveJourney({ ...input, projectId: project.id }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className="quick-check" aria-label="Choose a check">
      <fieldset className="check-choices" disabled={saving}>
        <legend className="sr-only">What should we check?</legend>
        <label className={`check-choice ${kind === "load" ? "selected" : ""}`}>
          <input
            type="radio"
            name="check-kind"
            value="load"
            checked={kind === "load"}
            onChange={() => setKind("load")}
          />
          <Globe size={19} aria-hidden="true" />
          <span>
            <strong>Page loads</strong>
            <span>Check that the page opens and displays content.</span>
          </span>
        </label>
        <label className={`check-choice ${kind === "text" ? "selected" : ""}`}>
          <input
            type="radio"
            name="check-kind"
            value="text"
            checked={kind === "text"}
            onChange={() => setKind("text")}
          />
          <TextSearch size={19} aria-hidden="true" />
          <span>
            <strong>Text is visible</strong>
            <span>Look for a heading, message or other expected text.</span>
          </span>
        </label>
      </fieldset>
      <div className="field">
        <label htmlFor="check-path">Page to check</label>
        <div className="check-url">
          <span>{new URL(project.url).host}</span>
          <input
            id="check-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            disabled={saving}
            required
            maxLength={500}
            aria-describedby="check-path-hint"
          />
        </div>
        <p id="check-path-hint" className="field-hint">
          Use / for the homepage, or a path such as /pricing.
        </p>
      </div>
      {kind === "text" && (
        <div className="field">
          <label htmlFor="check-text">Text that should be visible</label>
          <input
            id="check-text"
            placeholder="e.g. Welcome back"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            maxLength={500}
            disabled={saving}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="dialog-actions check-form-actions">
        <button
          type="button"
          className="text-link"
          onClick={onCustom}
          disabled={saving}
        >
          Custom steps
        </button>
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? "Saving…" : label}
          <ArrowRight size={15} />
        </button>
      </div>
    </form>
  );
}
